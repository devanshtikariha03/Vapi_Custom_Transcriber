// transcriptionService.js
require("dotenv").config();

const { Deepgram } = require("@deepgram/sdk");
const EventEmitter = require("events");

const MAX_RETRY_ATTEMPTS = 3;
const DEBOUNCE_DELAY_IN_SECS = 3;
const DEBOUNCE_DELAY = DEBOUNCE_DELAY_IN_SECS * 1000;
const DEEPGRAM_API_KEY = process.env.DEEPGRAM_API_KEY || "";

class TranscriptionService extends EventEmitter {
  constructor(config, logger) {
    super();
    this.config = config;
    this.logger = logger;
    this.flowLogger = require("./fileLogger").createNamedLogger(
      "transcriber-flow.log"
    );

    if (!DEEPGRAM_API_KEY) {
      throw new Error("Missing Deepgram API Key");
    }

    // Initialize Deepgram client
    this.deepgramClient = new Deepgram(DEEPGRAM_API_KEY);

    this.logger.logDetailed(
      "INFO",
      "Initializing Deepgram live connection",
      "TranscriptionService",
      { model: "nova-2", sample_rate: 16000, channels: 2 }
    );

    // Start live transcription
    this.deepgramLive = this.deepgramClient.transcription.live({
      encoding: "linear16",
      channels: 2,
      sample_rate: 16000,
      model: "nova-2",
      smart_format: true,
      interim_results: true,
      endpointing: 800,
      language: "en",
      multichannel: true,
    });

    this.finalResult = { customer: "", assistant: "" };
    this.retryAttempts = 0;
    this.lastTranscriptionTime = Date.now();
    this.pcmBuffer = Buffer.alloc(0);

    // Event handlers
    this.deepgramLive.on("open", () => {
      this.logger.logDetailed(
        "INFO",
        "Deepgram connection opened",
        "TranscriptionService"
      );
    });
    this.deepgramLive.on("close", () => {
      this.logger.logDetailed(
        "INFO",
        "Deepgram connection closed",
        "TranscriptionService"
      );
      this.emitTranscription();
    });
    this.deepgramLive.on("metadata", (data) => {
      this.logger.logDetailed(
        "DEBUG",
        "Deepgram metadata received",
        "TranscriptionService",
        data
      );
    });
    this.deepgramLive.on("transcript", (event) => {
      this.handleTranscript(event);
    });
    this.deepgramLive.on("error", (err) => {
      this.logger.logDetailed(
        "ERROR",
        "Deepgram error received",
        "TranscriptionService",
        { error: err }
      );
      this.emit("transcriptionerror", err);
    });
  }

  send(payload) {
    if (Buffer.isBuffer(payload)) {
      this.pcmBuffer = this.pcmBuffer.length
        ? Buffer.concat([this.pcmBuffer, payload])
        : payload;
    } else {
      this.logger.warn(
        "TranscriptionService: Received non-Buffer data chunk.",
        "TranscriptionService"
      );
    }
    if (this.deepgramLive.readyState === 1 && this.pcmBuffer.length > 0) {
      this.sendBufferedData(this.pcmBuffer);
      this.pcmBuffer = Buffer.alloc(0);
    }
  }

  sendBufferedData(bufferedData) {
    try {
      this.logger.logDetailed(
        "INFO",
        "Sending buffered data to Deepgram",
        "TranscriptionService",
        { bytes: bufferedData.length }
      );
      this.deepgramLive.send(bufferedData);
      this.retryAttempts = 0;
    } catch (error) {
      this.logger.logDetailed(
        "ERROR",
        "Error sending buffered data",
        "TranscriptionService",
        { error }
      );
      this.retryAttempts++;
      if (this.retryAttempts <= MAX_RETRY_ATTEMPTS) {
        setTimeout(() => this.sendBufferedData(bufferedData), 1000);
      } else {
        this.logger.logDetailed(
          "ERROR",
          "Max retry attempts reached, discarding data",
          "TranscriptionService"
        );
        this.retryAttempts = 0;
      }
    }
  }

  handleTranscript(transcription) {
    const alt = transcription.channel?.alternatives?.[0];
    if (!alt) {
      this.logger.logDetailed(
        "WARN",
        "Invalid transcript format",
        "TranscriptionService",
        { transcription }
      );
      return;
    }
    const text = alt.transcript.trim();
    if (!text) return;

    const currentTime = Date.now();
    const channelIndex = transcription.channel_index?.[0] ?? 0;
    const channel = channelIndex === 0 ? "customer" : "assistant";

    this.logger.logDetailed(
      "INFO",
      "Received transcript",
      "TranscriptionService",
      { channel, text }
    );

    this.finalResult[channel] = (this.finalResult[channel] + " " + text).trim();

    if (
      transcription.is_final ||
      transcription.speech_final ||
      currentTime - this.lastTranscriptionTime >= DEBOUNCE_DELAY
    ) {
      this.emitTranscription();
    }
    this.lastTranscriptionTime = currentTime;
  }

  emitTranscription() {
    for (const chan of ["customer", "assistant"]) {
      const transcript = this.finalResult[chan].trim();
      if (transcript) {
        this.logger.logDetailed(
          "INFO",
          "Emitting transcription",
          "TranscriptionService",
          { channel: chan, transcript }
        );
        this.emit("transcription", transcript, chan);
        this.finalResult[chan] = "";
      }
    }
  }
}

module.exports = TranscriptionService;
