import { useEffect, useState } from 'react';

interface ErrorReport {
  message: string;
  stack?: string;
  timestamp: string;
  context?: Record<string, any>;
  userAgent: string;
  version: string;
}

export function ErrorLog() {
  const [errors, setErrors] = useState<ErrorReport[]>([]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadErrors();
  }, []);

  const loadErrors = async () => {
    try {
      const { error_reports = [] } = await chrome.storage.local.get('error_reports');
      setErrors(error_reports.reverse()); // Most recent first
    } catch (err) {
      console.error('Failed to load error reports:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const clearErrors = async () => {
    try {
      await chrome.storage.local.set({ error_reports: [] });
      setErrors([]);
    } catch (err) {
      console.error('Failed to clear error reports:', err);
    }
  };

  const exportErrors = () => {
    const dataStr = JSON.stringify(errors, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `error-reports-${new Date().toISOString()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="p-4 bg-gray-50 border border-gray-200 rounded">
        <p className="text-gray-600">Loading error reports...</p>
      </div>
    );
  }

  if (errors.length === 0) {
    return (
      <div className="p-4 bg-green-50 border border-green-200 rounded">
        <p className="text-green-700">✅ No errors recorded (good news!)</p>
        <p className="text-sm text-green-600 mt-2">
          Errors are automatically reported to help improve the extension.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-lg font-semibold">Error Log ({errors.length})</h3>
          <p className="text-sm text-gray-600">
            Errors are automatically reported to help improve the extension
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={exportErrors}
            className="px-3 py-1 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded"
          >
            Export
          </button>
          <button
            onClick={clearErrors}
            className="px-3 py-1 text-sm bg-gray-200 hover:bg-gray-300 rounded"
          >
            Clear All
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {errors.map((error, idx) => (
          <div key={idx} className="border border-red-200 rounded bg-red-50 p-3">
            <div
              className="flex justify-between items-start cursor-pointer"
              onClick={() => setExpanded(expanded === idx ? null : idx)}
            >
              <div className="flex-1">
                <p className="font-medium text-red-800">{error.message}</p>
                <p className="text-xs text-gray-600 mt-1">
                  {new Date(error.timestamp).toLocaleString()}
                </p>
              </div>
              <span className="text-gray-500 ml-2">{expanded === idx ? '▼' : '▶'}</span>
            </div>

            {expanded === idx && (
              <div className="mt-3 space-y-2 text-sm">
                {error.context && (
                  <div>
                    <p className="font-semibold text-gray-700">Context:</p>
                    <pre className="bg-white p-2 rounded overflow-x-auto text-xs border border-gray-200">
                      {JSON.stringify(error.context, null, 2)}
                    </pre>
                  </div>
                )}
                {error.stack && (
                  <div>
                    <p className="font-semibold text-gray-700">Stack Trace:</p>
                    <pre className="bg-white p-2 rounded overflow-x-auto text-xs border border-gray-200 max-h-48 overflow-y-auto">
                      {error.stack}
                    </pre>
                  </div>
                )}
                <div className="text-xs text-gray-600 pt-2 border-t border-red-200">
                  <p>
                    <strong>Version:</strong> {error.version}
                  </p>
                  <p className="mt-1 break-all">
                    <strong>User Agent:</strong> {error.userAgent}
                  </p>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="p-3 bg-blue-50 border border-blue-200 rounded text-sm">
        <p className="text-blue-900">
          <strong>💡 Tip:</strong> If you're reporting a bug, use the "Export" button to download
          error details and attach them to your bug report.
        </p>
      </div>
    </div>
  );
}
