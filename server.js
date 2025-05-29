// server.js
require("dotenv").config();

const express = require("express");
const http = require("http");
const TranscriptionService = require("./transcriptionService");
const FileLogger = require("./fileLogger");

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (_req, res) => {
  res.send("Custom Transcriber Service is running");
});

const server = http.createServer(app);

// Use only the PORT that Render injects into the environment
const port = process.env.PORT;
if (!port) {
  console.error("ERROR: process.env.PORT is not defined!");
  process.exit(1);
}

const config = {
  DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
  PORT: port,
};

const logger = new FileLogger();
const transcriptionService = new TranscriptionService(config, logger);

// WebSocket setup
transcriptionService.setupWebSocketServer = function (server) {
  const { Server: WebSocketServer } = require("ws");
  const wss = new WebSocketServer({
    server,
    path: "/api/custom-transcriber",
  });

  wss.on("connection", (ws) => {
    logger.logDetailed(
      "INFO",
      "New WebSocket client connected on /api/custom-transcriber",
      "Server"
    );

    ws.on("message", (data, isBinary) => {
      if (!isBinary) {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === "start") {
            logger.logDetailed(
              "INFO",
              "Received start message from client",
              "Server",
              { sampleRate: msg.sampleRate, channels: msg.channels }
            );
          }
        } catch (err) {
          logger.error("JSON parse error", "Server", err);
        }
      } else {
        transcriptionService.send(data);
      }
    });

    ws.on("close", () => {
      logger.logDetailed("INFO", "WebSocket client disconnected", "Server");
      if (
        transcriptionService.deepgramLive &&
        transcriptionService.deepgramLive.readyState === 1
      ) {
        transcriptionService.deepgramLive.finish();
      }
    });

    ws.on("error", (error) => {
      logger.error("WebSocket error", "Server", error);
    });

    transcriptionService.on("transcription", (text, channel) => {
      const response = {
        type: "transcriber-response",
        transcription: text,
        channel,
      };
      ws.send(JSON.stringify(response));
      logger.logDetailed("INFO", "Sent transcription to client", "Server", {
        channel,
        text,
      });
    });

    transcriptionService.on("transcriptionerror", (err) => {
      ws.send(
        JSON.stringify({ type: "error", error: "Transcription service error" })
      );
      logger.error("Transcription service error", "Server", err);
    });
  });
};

transcriptionService.setupWebSocketServer(server);

// Listen on 0.0.0.0 so Render can route traffic correctly
server.listen(port, "0.0.0.0", () => {
  console.log(`✅ Server is listening on 0.0.0.0:${port}`);
});
