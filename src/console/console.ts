/**
 * Console page logic - Terminal-like log viewer
 */

import { STORAGE_KEYS } from '../shared/constants';
import { LogEntry, LogLevel, Stats, JobHistoryItem } from '../shared/types';
import { Logger } from '../shared/logger';
import { ApiClient } from '../shared/api-client';
import { createIcons, RotateCcw, XCircle, Download, Copy, Trash2, Settings, X, Github, Play, StopCircle } from 'lucide';

// UI Elements
const statusIndicator = document.getElementById('status-indicator')!;
const statusText = document.getElementById('status-text')!;
const apiStatusIndicator = document.getElementById('api-status-indicator')!;
const apiStatusText = document.getElementById('api-status-text')!;
const logOutput = document.getElementById('log-output')!;
const logContainer = document.getElementById('log-container')!;
const jobList = document.getElementById('job-list')!;
const logLimitSelect = document.getElementById('log-limit') as HTMLSelectElement;
const autoScrollCheckbox = document.getElementById('auto-scroll') as HTMLInputElement;
const clearBtn = document.getElementById('clear-btn') as HTMLButtonElement;
const copyBtn = document.getElementById('copy-btn') as HTMLButtonElement;
const exportBtn = document.getElementById('export-btn') as HTMLButtonElement;
const resetStuckBtn = document.getElementById('reset-stuck-btn') as HTMLButtonElement;
const cancelAllBtn = document.getElementById('cancel-all-btn') as HTMLButtonElement;
const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
const toggleBtn = document.getElementById('toggle-btn') as HTMLButtonElement;
const toggleBtnText = document.getElementById('toggle-btn-text')!;

// Settings modal elements
const settingsModal = document.getElementById('settings-modal')!;
const modalOverlay = document.getElementById('modal-overlay')!;
const closeModalBtn = document.getElementById('close-modal-btn') as HTMLButtonElement;
const cancelSettingsBtn = document.getElementById('cancel-settings-btn') as HTMLButtonElement;
const saveSettingsBtn = document.getElementById('save-settings-btn') as HTMLButtonElement;
const settingsApiUrl = document.getElementById('settings-api-url') as HTMLInputElement;
const settingsApiKey = document.getElementById('settings-api-key') as HTMLInputElement;
const settingsRetryAttempts = document.getElementById('settings-retry-attempts') as HTMLInputElement;
const settingsMaxRetryDelay = document.getElementById('settings-max-retry-delay') as HTMLInputElement;

// Stats elements
const versionInfo = document.getElementById('version-info')!;
const statPending = document.getElementById('stat-pending')!;
const statProcessing = document.getElementById('stat-processing')!;
const statProcessed = document.getElementById('stat-processed')!;
const statSucceeded = document.getElementById('stat-succeeded')!;
const statFailed = document.getElementById('stat-failed')!;

// Filter checkboxes
const filterDebug = document.getElementById('filter-debug') as HTMLInputElement;
const filterInfo = document.getElementById('filter-info') as HTMLInputElement;
const filterSuccess = document.getElementById('filter-success') as HTMLInputElement;
const filterWarning = document.getElementById('filter-warning') as HTMLInputElement;
const filterError = document.getElementById('filter-error') as HTMLInputElement;

// State
let allLogs: LogEntry[] = [];

// Storage keys for preferences
const FILTER_STORAGE_KEY = 'console-filter-preferences';

/**
 * Load and display logs
 */
async function loadLogs(): Promise<void> {
  try {
    allLogs = await Logger.getLogs();
    renderLogs();

    // Auto-scroll to bottom if enabled
    if (autoScrollCheckbox.checked) {
      scrollToBottom();
    }
  } catch (error) {
    console.error('Failed to load logs:', error);
  }
}

/**
 * Load and display job history
 */
async function loadJobHistory(): Promise<void> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.JOB_HISTORY);
    const history: JobHistoryItem[] = result[STORAGE_KEYS.JOB_HISTORY] || [];
    renderJobHistory(history);
  } catch (error) {
    console.error('Failed to load job history:', error);
  }
}

/**
 * Render job history cards
 */
function renderJobHistory(history: JobHistoryItem[]): void {
  if (history.length === 0) {
    jobList.innerHTML = '<div class="job-empty">No jobs processed yet</div>';
    return;
  }

  const fragment = document.createDocumentFragment();

  history.forEach((job) => {
    const card = createJobCard(job);
    fragment.appendChild(card);
  });

  jobList.innerHTML = '';
  jobList.appendChild(fragment);
}

/**
 * Create a job card element
 */
function createJobCard(job: JobHistoryItem): HTMLElement {
  const card = document.createElement('div');
  card.className = 'job-card';

  const timestamp = new Date(job.timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const priceDisplay = job.price ? `$${Math.round(job.price / 100)}` : 'N/A';

  card.innerHTML = `
    <div class="job-details">
      <div class="job-title">${escapeHtml(job.title)}</div>
      <a href="${escapeHtml(job.url)}" target="_blank" rel="noopener noreferrer" class="job-url" title="${escapeHtml(job.url)}">
        ${escapeHtml(job.url)}
      </a>
      <div class="job-info">
        <span class="job-price">Price: ${priceDisplay}</span>
        <span class="job-id">ID: ${job.id.slice(0, 8)}</span>
      </div>
      <div class="job-meta">
        <span class="job-status ${job.status}">
          <span class="job-status-dot"></span>
          ${job.status}
        </span>
        <span class="job-timestamp">${timestamp}</span>
      </div>
    </div>
  `;

  return card;
}

/**
 * Render logs with current filters and limit
 */
function renderLogs(): void {
  const filteredLogs = getFilteredLogs();

  if (filteredLogs.length === 0) {
    logOutput.innerHTML = `
      <div class="log-empty">
        No logs match your filters. Try adjusting the filter settings.
      </div>
    `;
    return;
  }

  // Apply log limit (show most recent N logs)
  const limit = parseInt(logLimitSelect.value, 10);
  const logsToShow = limit === -1 ? filteredLogs : filteredLogs.slice(-limit);

  const fragment = document.createDocumentFragment();

  logsToShow.forEach((log) => {
    const entry = createLogEntry(log);
    fragment.appendChild(entry);
  });

  logOutput.innerHTML = '';
  logOutput.appendChild(fragment);
}

/**
 * Create a log entry element
 */
function createLogEntry(log: LogEntry): HTMLElement {
  const entry = document.createElement('div');
  entry.className = `log-entry ${log.level.toLowerCase()}`;

  const timestamp = new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false });

  entry.innerHTML = `
    <div class="log-line">
      <span class="log-timestamp">[${timestamp}]</span>
      <span class="log-level">${log.level}</span>
      <span class="log-message">${escapeHtml(log.message)}</span>
    </div>
  `;

  // Add context if available (only for ERROR and WARNING levels)
  if ((log.level === LogLevel.ERROR || log.level === LogLevel.WARNING) && log.context && Object.keys(log.context).length > 0) {
    const contextDiv = document.createElement('div');
    contextDiv.className = 'log-context';

    // Show simplified context for errors
    const lines: string[] = [];
    for (const [key, value] of Object.entries(log.context)) {
      if (value === undefined || value === null) continue;

      // Skip overly verbose fields
      if (key === 'data' || key === 'body' || key === 'response') continue;

      if (typeof value === 'object') {
        lines.push(`${key}: ${JSON.stringify(value)}`);
      } else {
        lines.push(`${key}: ${value}`);
      }
    }

    if (lines.length > 0) {
      contextDiv.textContent = lines.join(', ');
      entry.appendChild(contextDiv);
    }
  }

  return entry;
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Get filtered logs based on current filters
 */
function getFilteredLogs(): LogEntry[] {
  const enabledLevels = new Set<LogLevel>();

  if (filterDebug.checked) enabledLevels.add(LogLevel.DEBUG);
  if (filterInfo.checked) enabledLevels.add(LogLevel.INFO);
  if (filterSuccess.checked) enabledLevels.add(LogLevel.SUCCESS);
  if (filterWarning.checked) enabledLevels.add(LogLevel.WARNING);
  if (filterError.checked) enabledLevels.add(LogLevel.ERROR);

  return allLogs.filter((log) => {
    // Filter by level
    return enabledLevels.has(log.level);
  });
}

/**
 * Save filter preferences to local storage
 */
async function saveFilterPreferences(): Promise<void> {
  const preferences = {
    debug: filterDebug.checked,
    info: filterInfo.checked,
    success: filterSuccess.checked,
    warning: filterWarning.checked,
    error: filterError.checked,
  };
  await chrome.storage.local.set({ [FILTER_STORAGE_KEY]: preferences });
}

/**
 * Load filter preferences from local storage
 */
async function loadFilterPreferences(): Promise<void> {
  const result = await chrome.storage.local.get(FILTER_STORAGE_KEY);
  const preferences = result[FILTER_STORAGE_KEY];

  if (preferences) {
    filterDebug.checked = preferences.debug ?? true;
    filterInfo.checked = preferences.info ?? true;
    filterSuccess.checked = preferences.success ?? true;
    filterWarning.checked = preferences.warning ?? true;
    filterError.checked = preferences.error ?? true;
  }
}

/**
 * Scroll to bottom of log container
 */
function scrollToBottom(): void {
  logContainer.scrollTop = logContainer.scrollHeight;
}

/**
 * Load and display stats
 */
async function loadStats(): Promise<void> {
  try {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.IS_RUNNING,
      STORAGE_KEYS.STATS,
      STORAGE_KEYS.API_KEY,
      STORAGE_KEYS.API_URL,
    ]);

    const isRunning = result[STORAGE_KEYS.IS_RUNNING] || false;
    const apiKey = result[STORAGE_KEYS.API_KEY];
    const apiUrl = result[STORAGE_KEYS.API_URL];
    const stats: Stats = result[STORAGE_KEYS.STATS] || {
      processed: 0,
      succeeded: 0,
      failed: 0,
    };

    // Update status indicator
    statusIndicator.classList.remove('active', 'processing', 'stopped');
    if (!isRunning) {
      statusIndicator.classList.add('stopped');
      statusText.textContent = 'STOPPED';
    } else if (stats.currentJob) {
      statusIndicator.classList.add('processing');
      statusText.textContent = `PROCESSING: ${stats.currentJob.title}`;
    } else {
      statusIndicator.classList.add('active');
      statusText.textContent = 'ACTIVE';
    }

    // Update toggle button
    if (!apiKey || !apiUrl) {
      toggleBtn.disabled = true;
    } else {
      toggleBtn.disabled = false;
    }

    if (isRunning) {
      toggleBtnText.textContent = 'Stop';
      toggleBtn.classList.remove('btn-primary');
      toggleBtn.classList.add('btn-secondary');
      // Show Stop icon, hide Play icon
      const playIcon = toggleBtn.querySelector('.icon-play') as HTMLElement;
      const stopIcon = toggleBtn.querySelector('.icon-stop') as HTMLElement;
      if (playIcon) playIcon.style.display = 'none';
      if (stopIcon) stopIcon.style.display = 'block';
    } else {
      toggleBtnText.textContent = 'Start';
      toggleBtn.classList.remove('btn-secondary');
      toggleBtn.classList.add('btn-primary');
      // Show Play icon, hide Stop icon
      const playIcon = toggleBtn.querySelector('.icon-play') as HTMLElement;
      const stopIcon = toggleBtn.querySelector('.icon-stop') as HTMLElement;
      if (playIcon) playIcon.style.display = 'block';
      if (stopIcon) stopIcon.style.display = 'none';
    }

    // Re-render all icons
    createIcons({
      icons: { RotateCcw, XCircle, Download, Copy, Trash2, Settings, X, Github, Play, StopCircle }
    });

    // Update stats
    statProcessed.textContent = stats.processed.toString();
    statSucceeded.textContent = stats.succeeded.toString();
    statFailed.textContent = stats.failed.toString();

    // Load pending and processing job counts from API
    if (result[STORAGE_KEYS.API_KEY] && result[STORAGE_KEYS.API_URL]) {
      try {
        const client = await ApiClient.fromStorage();

        // Fetch pending count
        const pendingData = await client.getQueueItems({ status: 'pending', limit: 1 });
        statPending.textContent = pendingData.total.toString();

        // Fetch processing count
        const processingData = await client.getQueueItems({ status: 'processing', limit: 1 });
        statProcessing.textContent = processingData.total.toString();
      } catch (error) {
        console.error('Failed to load job counts:', error);
        statPending.textContent = '-';
        statProcessing.textContent = '-';
      }
    } else {
      statPending.textContent = '-';
      statProcessing.textContent = '-';
    }
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

/**
 * Check API health
 */
async function checkApiHealth(): Promise<void> {
  try {
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.API_KEY,
      STORAGE_KEYS.API_URL,
    ]);

    if (!result[STORAGE_KEYS.API_KEY] || !result[STORAGE_KEYS.API_URL]) {
      apiStatusIndicator.classList.remove('active', 'processing');
      apiStatusIndicator.classList.add('stopped');
      apiStatusText.textContent = 'NOT CONFIGURED';
      return;
    }

    const client = await ApiClient.fromStorage();
    const health = await client.healthCheck();

    if (health.status === 'healthy') {
      apiStatusIndicator.classList.remove('stopped', 'processing');
      apiStatusIndicator.classList.add('active');
      apiStatusText.textContent = 'API HEALTHY';
    } else {
      apiStatusIndicator.classList.remove('active', 'stopped');
      apiStatusIndicator.classList.add('processing');
      apiStatusText.textContent = 'API DEGRADED';
    }
  } catch (_error) {
    apiStatusIndicator.classList.remove('active', 'processing');
    apiStatusIndicator.classList.add('stopped');
    apiStatusText.textContent = 'API UNREACHABLE';
  }
}

/**
 * Clear all logs and job history
 */
async function clearLogs(): Promise<void> {
  if (!confirm('Are you sure you want to clear all logs and job history? This cannot be undone.')) {
    return;
  }

  try {
    await Logger.clearLogs();
    await chrome.storage.local.remove(STORAGE_KEYS.JOB_HISTORY);
    allLogs = [];
    renderLogs();
    loadJobHistory();
  } catch (error) {
    console.error('Failed to clear logs:', error);
    alert('Failed to clear logs');
  }
}

/**
 * Reset stuck jobs (jobs stuck in processing status)
 */
async function resetStuckJobs(): Promise<void> {
  if (!confirm('This will reset all jobs stuck in "processing" status back to "pending". Continue?')) {
    return;
  }

  try {
    // Disable button during operation
    resetStuckBtn.disabled = true;
    resetStuckBtn.textContent = 'Resetting...';

    await Logger.info('Resetting stuck jobs...');

    const client = await ApiClient.fromStorage();

    // Try the cleanup endpoint first (now that CORS is fixed)
    try {
      const result = await client.cleanupStaleJobs();
      await Logger.info(`Reset ${result.cleaned} stuck job${result.cleaned !== 1 ? 's' : ''}`);
      await loadStats();
      alert(`Successfully reset ${result.cleaned} stuck job${result.cleaned !== 1 ? 's' : ''} back to pending`);
    } catch (cleanupError) {
      // If cleanup fails, fall back to manual PATCH method
      await Logger.warning('Cleanup endpoint failed, trying manual reset...', { error: cleanupError });
      const result = await client.resetStuckJobsManually();
      await Logger.info(`Reset ${result.reset} stuck job${result.reset !== 1 ? 's' : ''} via PATCH`);
      await loadStats();
      alert(`Successfully reset ${result.reset} stuck job${result.reset !== 1 ? 's' : ''} back to pending`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to reset stuck jobs:', error);
    await Logger.error('Failed to reset stuck jobs', { error: errorMessage });
    alert(`Failed to reset stuck jobs: ${errorMessage}`);
  } finally {
    resetStuckBtn.disabled = false;
    resetStuckBtn.textContent = 'Reset Stuck';
  }
}

/**
 * Cancel all pending jobs
 */
async function cancelAllPendingJobs(): Promise<void> {
  if (!confirm('Are you sure you want to cancel all pending jobs? This cannot be undone.')) {
    return;
  }

  try {
    // Disable button during operation
    cancelAllBtn.disabled = true;
    cancelAllBtn.textContent = 'Cancelling...';

    await Logger.info('Cancelling all pending jobs...');

    const client = await ApiClient.fromStorage();
    const result = await client.cancelAllPendingJobs();

    await Logger.info(`Cancelled ${result.cancelled} pending job${result.cancelled !== 1 ? 's' : ''}`);

    // Refresh stats
    await loadStats();

    alert(`Successfully cancelled ${result.cancelled} pending job${result.cancelled !== 1 ? 's' : ''}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to cancel pending jobs:', error);
    await Logger.error('Failed to cancel pending jobs', { error: errorMessage });
    alert(`Failed to cancel pending jobs: ${errorMessage}`);
  } finally {
    cancelAllBtn.disabled = false;
    cancelAllBtn.textContent = 'Cancel All Pending';
  }
}

/**
 * Copy logs to clipboard
 */
async function copyLogs(): Promise<void> {
  const filteredLogs = getFilteredLogs();

  if (filteredLogs.length === 0) {
    alert('No logs to copy');
    return;
  }

  try {
    // Text format for clipboard
    const content = filteredLogs
      .map((log) => {
        const timestamp = new Date(log.timestamp).toLocaleTimeString('en-US', { hour12: false });
        const context = log.context ? ` ${JSON.stringify(log.context)}` : '';
        return `[${timestamp}] ${log.level}: ${log.message}${context}`;
      })
      .join('\n');

    await navigator.clipboard.writeText(content);

    // Temporarily change button text
    const textSpan = copyBtn.querySelector('span');
    if (textSpan) {
      const originalText = textSpan.textContent;
      textSpan.textContent = 'Copied!';
      setTimeout(() => {
        textSpan.textContent = originalText;
      }, 2000);
    }
  } catch (error) {
    console.error('Failed to copy logs:', error);
    alert('Failed to copy logs to clipboard');
  }
}

/**
 * Open settings modal
 */
async function openSettings(): Promise<void> {
  try {
    // Load current settings
    const result = await chrome.storage.local.get([
      STORAGE_KEYS.API_URL,
      STORAGE_KEYS.API_KEY,
      STORAGE_KEYS.RETRY_ATTEMPTS,
      STORAGE_KEYS.MAX_RETRY_DELAY,
    ]);

    settingsApiUrl.value = result[STORAGE_KEYS.API_URL] || '';
    settingsApiKey.value = result[STORAGE_KEYS.API_KEY] || '';
    settingsRetryAttempts.value = result[STORAGE_KEYS.RETRY_ATTEMPTS]?.toString() || '10';
    settingsMaxRetryDelay.value = (result[STORAGE_KEYS.MAX_RETRY_DELAY] / 1000)?.toString() || '30';

    // Show modal
    settingsModal.style.display = 'flex';

    // Re-render icons for modal
    createIcons({
      icons: { RotateCcw, XCircle, Download, Copy, Trash2, Settings, X, Github }
    });
  } catch (error) {
    console.error('Failed to load settings:', error);
  }
}

/**
 * Close settings modal
 */
function closeSettings(): void {
  settingsModal.style.display = 'none';
  settingsApiUrl.value = '';
  settingsApiKey.value = '';
  settingsRetryAttempts.value = '';
  settingsMaxRetryDelay.value = '';
}

/**
 * Save settings
 */
async function saveSettings(): Promise<void> {
  const apiUrl = settingsApiUrl.value.trim();
  const apiKey = settingsApiKey.value.trim();
  const retryAttempts = parseInt(settingsRetryAttempts.value, 10);
  const maxRetryDelay = parseInt(settingsMaxRetryDelay.value, 10) * 1000; // Convert seconds to milliseconds

  // Validate API URL
  if (!apiUrl) {
    alert('Please enter an API URL');
    return;
  }

  try {
    new URL(apiUrl); // Validate URL format
  } catch {
    alert('Invalid API URL format');
    return;
  }

  // Validate API key
  if (!apiKey) {
    alert('Please enter an API key');
    return;
  }

  if (!apiKey.startsWith('isk_')) {
    alert('API key must start with "isk_"');
    return;
  }

  // Validate retry attempts
  if (isNaN(retryAttempts) || retryAttempts < 1 || retryAttempts > 20) {
    alert('Retry attempts must be between 1 and 20');
    return;
  }

  // Validate max retry delay
  if (isNaN(maxRetryDelay) || maxRetryDelay < 5000 || maxRetryDelay > 120000) {
    alert('Max retry delay must be between 5 and 120 seconds');
    return;
  }

  try {
    // Test API connection with health check
    await Logger.info('Testing API connection', { apiUrl });

    const client = new ApiClient(apiUrl, apiKey);
    const health = await client.healthCheck();

    await Logger.info('API health check successful', { status: health.status, apiUrl });

    // Save configuration
    await chrome.storage.local.set({
      [STORAGE_KEYS.API_URL]: apiUrl,
      [STORAGE_KEYS.API_KEY]: apiKey,
      [STORAGE_KEYS.RETRY_ATTEMPTS]: retryAttempts,
      [STORAGE_KEYS.MAX_RETRY_DELAY]: maxRetryDelay,
    });

    await Logger.success('Settings saved successfully');
    closeSettings();

    // Refresh stats and API health
    loadStats();
    checkApiHealth();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await Logger.error('API health check failed', { error: errorMessage, apiUrl });
    console.error('Failed to save settings:', error);
    alert(`API connection failed: ${errorMessage}`);
  }
}

/**
 * Export logs to file
 */
function exportLogs(): void {
  const filteredLogs = getFilteredLogs();

  if (filteredLogs.length === 0) {
    alert('No logs to export');
    return;
  }

  // Ask user for format
  const format = prompt('Export format:\n1. JSON\n2. Text\n\nEnter 1 or 2:', '1');

  if (!format) return;

  let content: string;
  let filename: string;
  let mimeType: string;

  if (format === '1') {
    // JSON format
    content = JSON.stringify(filteredLogs, null, 2);
    filename = `isekai-logs-${Date.now()}.json`;
    mimeType = 'application/json';
  } else if (format === '2') {
    // Text format
    content = filteredLogs
      .map((log) => {
        const timestamp = new Date(log.timestamp).toISOString();
        const context = log.context ? `\n  Context: ${JSON.stringify(log.context)}` : '';
        return `[${timestamp}] ${log.level}: ${log.message}${context}`;
      })
      .join('\n\n');
    filename = `isekai-logs-${Date.now()}.txt`;
    mimeType = 'text/plain';
  } else {
    alert('Invalid format selection');
    return;
  }

  // Create download
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Toggle polling (start/stop)
 */
async function togglePolling(): Promise<void> {
  try {
    toggleBtn.disabled = true;

    const result = await chrome.storage.local.get(STORAGE_KEYS.IS_RUNNING);
    const isRunning = result[STORAGE_KEYS.IS_RUNNING] || false;

    if (isRunning) {
      // Stop polling
      const response = await chrome.runtime.sendMessage({ action: 'STOP_POLLING' });
      if (!response.success) {
        throw new Error(response.error || 'Failed to stop polling');
      }
      await Logger.info('Polling stopped from console');
    } else {
      // Start polling
      await Logger.info('Starting polling from console...');
      const response = await chrome.runtime.sendMessage({ action: 'START_POLLING' });
      if (!response.success) {
        throw new Error(response.error || 'Failed to start polling');
      }
      await Logger.success('Polling started successfully from console');
    }

    // Refresh UI
    await loadStats();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Failed to toggle polling:', error);
    await Logger.error('Failed to toggle polling from console', { error: errorMessage });

    // Refresh status to ensure UI is in sync
    await loadStats();
  } finally {
    toggleBtn.disabled = false;
  }
}

/**
 * Listen for storage changes to update in real-time
 */
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local') {
    // Reload logs if they changed
    if (changes['isekai-logs']) {
      loadLogs();
    }

    // Reload stats if they changed
    if (changes[STORAGE_KEYS.IS_RUNNING] || changes[STORAGE_KEYS.STATS]) {
      loadStats();
    }

    // Reload job history if it changed
    if (changes[STORAGE_KEYS.JOB_HISTORY]) {
      loadJobHistory();
    }
  }
});

// Event listeners for filters - save preferences when changed
filterDebug.addEventListener('change', () => {
  renderLogs();
  saveFilterPreferences();
});
filterInfo.addEventListener('change', () => {
  renderLogs();
  saveFilterPreferences();
});
filterSuccess.addEventListener('change', () => {
  renderLogs();
  saveFilterPreferences();
});
filterWarning.addEventListener('change', () => {
  renderLogs();
  saveFilterPreferences();
});
filterError.addEventListener('change', () => {
  renderLogs();
  saveFilterPreferences();
});

clearBtn.addEventListener('click', clearLogs);
copyBtn.addEventListener('click', copyLogs);
exportBtn.addEventListener('click', exportLogs);
resetStuckBtn.addEventListener('click', resetStuckJobs);
cancelAllBtn.addEventListener('click', cancelAllPendingJobs);
settingsBtn.addEventListener('click', openSettings);
toggleBtn.addEventListener('click', togglePolling);
closeModalBtn.addEventListener('click', closeSettings);
modalOverlay.addEventListener('click', closeSettings);
cancelSettingsBtn.addEventListener('click', closeSettings);
saveSettingsBtn.addEventListener('click', saveSettings);

// Initial load
async function wakeBackgroundServiceWorker(): Promise<void> {
  try {
    // This is a dedicated automation browser. Opening the console must repair
    // polling even after a transient Core outage or a lost Manifest V3 alarm.
    const response = await chrome.runtime.sendMessage({ action: 'ENSURE_POLLING' });
    if (!response?.success) {
      throw new Error(response?.error || 'Polling could not be ensured');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await Logger.warning('Failed to wake background service worker', { error: message });
  }
}

async function initialize() {
  await wakeBackgroundServiceWorker();
  await loadFilterPreferences();
  loadLogs();
  loadStats();
  loadJobHistory();
  checkApiHealth();

  // Initialize Lucide icons
  createIcons({
    icons: {
      RotateCcw,
      XCircle,
      Download,
      Copy,
      Trash2,
      Settings,
      X,
      Github,
      Play,
      StopCircle,
    }
  });
}

initialize();

// Refresh periodically - only when page is visible
let refreshInterval: number | null = null;

// Track API health interval separately
let apiHealthInterval: number | null = null;

function startRefreshInterval() {
  if (refreshInterval !== null) return;

  refreshInterval = window.setInterval(() => {
    loadLogs();
    loadStats();
    loadJobHistory();
  }, 30000); // Every 30 seconds (reduced from 10)

  // Check API health every 60 seconds (only once)
  if (apiHealthInterval === null) {
    checkApiHealth();
    apiHealthInterval = window.setInterval(() => {
      checkApiHealth();
    }, 60000);
  }
}

function stopRefreshInterval() {
  if (refreshInterval !== null) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
  if (apiHealthInterval !== null) {
    clearInterval(apiHealthInterval);
    apiHealthInterval = null;
  }
}

/**
 * Load and display extension version
 */
function loadVersion() {
  const manifest = chrome.runtime.getManifest();
  versionInfo.textContent = `v${manifest.version}`;
}

// Only refresh when page is visible
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopRefreshInterval();
  } else {
    loadLogs();
    loadStats();
    loadJobHistory();
    startRefreshInterval();
  }
});

// Initialize version info
loadVersion();

// Start refreshing
startRefreshInterval();

console.log('Console page loaded');
