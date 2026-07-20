import winston from "winston";
import fs from "fs-extra";
import path from "path";

const logDir = "logs";

fs.ensureDirSync(logDir);

export const Logger = winston.createLogger({
  level: "debug",

  format: winston.format.combine(
    winston.format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss",
    }),
    winston.format.printf(({ level, message, timestamp }) => {
      return `[${timestamp}] ${level.toUpperCase()} : ${message}`;
    })
  ),

  transports: [
    new winston.transports.Console(),

    new winston.transports.File({
      filename: path.join(logDir, "aqw.log"),
    }),
  ],
});
