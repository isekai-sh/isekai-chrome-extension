// Shared type definitions for the extension

export interface Job {
  id: string;
  deviationId: string;
  pricePresetId: string;
  price: number; // In cents
  attempts: number;
  deviation: {
    title: string;
    deviationUrl: string;
    thumbnailUrl?: string;
  };
  pricePreset: {
    currency: string;
  };
}

export interface JobHistoryItem {
  id: string;
  title: string;
  url: string;
  thumbnailUrl?: string;
  status: 'processing' | 'completed' | 'failed';
  timestamp: number;
  price?: number;
}

export interface NextJobResponse {
  item: Job | null;
}

export interface Stats {
  processed: number;
  succeeded: number;
  failed: number;
  lastProcessedAt?: number;
  currentJob?: {
    id: string;
    title: string;
  };
}

export interface StorageData {
  apiKey?: string;
  clientId?: string;
  isRunning?: boolean;
  apiUrl?: string;
  pollingInterval?: number; // In minutes
  stats?: Stats;
}

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  SUCCESS = 'SUCCESS',
  WARNING = 'WARNING',
  ERROR = 'ERROR',
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  context?: Record<string, any>;
  jobId?: string;
}

export type MessageType =
  | { type: 'PING' }
  | { type: 'START_JOB'; job: Job }
  | { type: 'JOB_SUCCESS'; jobId: string }
  | { type: 'JOB_FAILED'; jobId: string; error: string }
  | { action: 'START_POLLING' }
  | { action: 'ENSURE_POLLING' }
  | { action: 'STOP_POLLING' }
  | { action: 'GET_STATUS' };
