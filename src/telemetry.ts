import { TelemetryReporter } from '@vscode/extension-telemetry';

// Replace with your Azure Application Insights connection string.
// Create a free resource at: portal.azure.com → Application Insights → New
// Then copy the "Connection String" from the Overview page.
const CONNECTION_STRING = 'PASTE_APPINSIGHTS_CONNECTION_STRING_HERE';

let reporter: TelemetryReporter | undefined;

export function initTelemetry(): TelemetryReporter {
  reporter = new TelemetryReporter(CONNECTION_STRING);
  return reporter;
}

export function trackEvent(
  name: string,
  properties?: Record<string, string>,
  measurements?: Record<string, number>,
): void {
  // reporter automatically checks vscode.env.isTelemetryEnabled — no-op if user opted out
  reporter?.sendTelemetryEvent(name, properties, measurements);
}

export function disposeTelemetry(): void {
  reporter?.dispose();
  reporter = undefined;
}
