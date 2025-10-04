// src/utils/logger.ts
import winston from 'winston';

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  PAYMENT = 'payment',
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  context?: Record<string, any>;
  stackTrace?: string;
}

class Logger {
  private winstonLogger: winston.Logger;
  private isServerless: boolean;

  constructor() {
    // Detect serverless environment (Vercel, AWS Lambda, etc.)
    this.isServerless = !!(
      process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.LAMBDA_TASK_ROOT
    );

    // Use only console transport in all environments
    this.winstonLogger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
          return `${timestamp} [${level}] ${message} ${metaStr}`;
        })
      ),
      transports: [
        new winston.transports.Console({
          format: winston.format.colorize(),
        }),
      ],
    });

    // Debug serverless detection
    if (this.isServerless) {
      this.info('Running in serverless mode. File logging disabled.');
    }
  }

  public log(level: LogLevel, message: string, context?: Record<string, any>, error?: Error): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date(),
      context,
      stackTrace: error ? error.stack : undefined,
    };

    this.winstonLogger.log({
      level: level === LogLevel.PAYMENT ? 'info' : level,
      message,
      ...context,
      stackTrace: entry.stackTrace,
    });
  }

  public debug(message: string, context?: Record<string, any>, error?: Error): void {
    this.log(LogLevel.DEBUG, message, context, error);
  }

  public info(message: string, context?: Record<string, any>, error?: Error): void {
    this.log(LogLevel.INFO, message, context, error);
  }

  public warn(message: string, context?: Record<string, any>, error?: Error): void {
    this.log(LogLevel.WARN, message, context, error);
  }

  public error(message: string, context?: Record<string, any>, error?: Error): void {
    this.log(LogLevel.ERROR, message, context, error);
  }

  public payment(message: string, context?: Record<string, any>, error?: Error): void {
    this.log(LogLevel.PAYMENT, message, context, error);
  }
}

export const logger = new Logger();