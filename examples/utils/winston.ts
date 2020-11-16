import { createLogger, format, transports } from 'winston'

const defaultLevel = process.env.LOG_LEVEL || 'info'

const options = {
  exitOnError: false,
  level: defaultLevel,
  format: format.combine(
    format.metadata(),
    format.colorize(),
    format.timestamp(),
    format.printf((info: any) => {
      return `${info.timestamp} [PID:${process.pid}] [${info.level}] : ${info.message} ${
        Object.keys(info.metadata).length > 0 ? JSON.stringify(info.metadata) : ''
      }`
    }),
  ),
}

export const logger = createLogger(options)

logger.add(new transports.Console(process.env.NODE_ENV === 'production' ? {} : { level: 'debug' }))
logger.add(new transports.File({ filename: './logs/error.log', level: 'error' }))
