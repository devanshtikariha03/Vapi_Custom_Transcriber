// fileLogger.js
const fs = require("fs");

class FileLogger {
  constructor(filename = "transcriber-flow.log") {
    this.filename = filename;
  }

  logDetailed(level, msg, moduleName, meta) {
    const entry = [
      new Date().toISOString(),
      level,
      moduleName,
      msg,
      meta ? JSON.stringify(meta) : ""
    ].join(" | ") + "\n";
    fs.appendFileSync(this.filename, entry);
  }

  warn(msg, moduleName, meta) {
    this.logDetailed("WARN", msg, moduleName, meta);
  }

  error(msg, moduleName, meta) {
    this.logDetailed("ERROR", msg, moduleName, meta);
  }

  static createNamedLogger(filename) {
    return new FileLogger(filename);
  }
}

module.exports = FileLogger;
