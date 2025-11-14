const config = require('./config.js');

class Logger {
  httpLogger = (req, res, next) => {
    let send = res.send;
    res.send = (resBody) => {
      const logData = {
        authorized: !!req.headers.authorization,
        path: req.originalUrl,
        method: req.method,
        statusCode: res.statusCode,
        reqBody: JSON.stringify(req.body),
        resBody: JSON.stringify(resBody),
      };
      const level = this.statusToLogLevel(res.statusCode);
      this.log(level, 'http-req', logData);
      res.send = send;
      return res.send(resBody);
    };
    next();
  };

  log(level, type, logData) {
    // Skip logging if configuration is not available (e.g., during testing)
    if (!config.logging || !config.logging.source) {
      return;
    }

    const labels = { component: config.logging.source, level: level, type: type };
    const values = [this.nowString(), this.sanitize(logData)];
    const logEvent = { streams: [{ stream: labels, values: [values] }] };

    this.sendLogToGrafana(logEvent);
  }

  logDatabase(sql, params, executionTime) {
    const logData = {
      sql: sql,
      params: params ? JSON.stringify(params) : null,
      executionTime: executionTime,
    };
    this.log('info', 'database', logData);
  }

  logFactory(requestData, responseData, success, executionTime) {
    const logData = {
      requestBody: JSON.stringify(requestData),
      responseBody: JSON.stringify(responseData),
      success: success,
      executionTime: executionTime,
    };
    const level = success ? 'info' : 'error';
    this.log(level, 'factory', logData);
  }

  logError(error, context = {}) {
    const logData = {
      message: error.message,
      stack: error.stack,
      context: JSON.stringify(context),
    };
    this.log('error', 'unhandled-exception', logData);
  }

  statusToLogLevel(statusCode) {
    if (statusCode >= 500) return 'error';
    if (statusCode >= 400) return 'warn';
    return 'info';
  }

  nowString() {
    return (Math.floor(Date.now()) * 1000000).toString();
  }

  sanitize(logData) {
    let logStr = JSON.stringify(logData);
    // Sanitize password fields
    logStr = logStr.replace(/\\"password\\":\s*\\"[^"]*\\"/g, '\\"password\\": \\"*****\\"');
    logStr = logStr.replace(/"password":\s*"[^"]*"/g, '"password": "*****"');
    // Sanitize authorization tokens (keep first few characters for debugging)
    logStr = logStr.replace(/\\"authorization\\":\s*\\"Bearer\s+([^"]{10})[^"]*\\"/g, '\\"authorization\\": \\"Bearer $1*****\\"');
    logStr = logStr.replace(/"authorization":\s*"Bearer\s+([^"]{10})[^"]*"/g, '"authorization": "Bearer $1*****"');
    return logStr;
  }

  sendLogToGrafana(event) {
    // Skip logging if configuration is not available (e.g., during testing)
    if (!config.logging || !config.logging.url || !config.logging.apiKey) {
      return;
    }

    const body = JSON.stringify(event);
    fetch(`${config.logging.url}`, {
      method: 'post',
      body: body,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.logging.apiKey}`,
      },
    }).then((res) => {
      if (!res.ok) {
        console.log('Failed to send log to Grafana');
      }
    }).catch((error) => {
      console.log('Error sending log to Grafana:', error.message);
    });
  }
}

module.exports = new Logger();