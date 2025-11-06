const config = require('./config');
const os = require('os');

class Metrics {
	constructor() {
		this.httpRequestCounts = {
			total: 0,
			GET: 0,
			POST: 0,
			PUT: 0,
			DELETE: 0
		};

		this.authAttempts = {
			successful: 0,
			failed: 0
		};

		this.activeUsers = new Map();

		this.pizzaMetrics = {
			sold: 0,
			failures: 0,
			revenue: 0
		};

		this.latencyMetrics = {
			serviceLatencies: [],
			pizzaLatencies: []
		};

		// Start periodic reporting
		this.startMetricsReporting();
	}

	// Middleware to track HTTP requests
	requestTracker = (req,res,next) => {
		const startTime = Date.now();

		// Count the request
		this.httpRequestCounts.total++;
		this.httpRequestCounts[req.method] = (this.httpRequestCounts[req.method] || 0) + 1;

		// Track active user if authenticated (update their last activity time)
		if (req.user && req.user.id) {
			this.activeUsers.set(req.user.id,Date.now()); // Update activity timestamp
		}

		// Track response time
		res.on('finish',() => {
			const latency = Date.now() - startTime;
			this.latencyMetrics.serviceLatencies.push(latency);

			// Keep only last 100 latencies to prevent memory issues
			if (this.latencyMetrics.serviceLatencies.length > 100) {
				this.latencyMetrics.serviceLatencies.shift();
			}
		});

		next();
	};

	// Track authentication attempts
	recordAuthAttempt(success,userId = null) {
		if (success) {
			this.authAttempts.successful++;
			if (userId) {
				this.activeUsers.set(userId,Date.now()); // Update activity timestamp on successful auth
			}
		} else {
			this.authAttempts.failed++;
		}
	}

	// Update user activity (for explicit activity tracking)
	updateUserActivity(userId) {
		if (userId) {
			this.activeUsers.set(userId,Date.now());
		}
	}

	// Remove user from active users (for explicit logout)
	removeActiveUser(userId) {
		if (userId) {
			this.activeUsers.delete(userId);
			console.log(`User ${userId} explicitly removed from active users`);
		}
	}

	// Track pizza purchases
	pizzaPurchase(success,latency,revenue) {
		if (success) {
			this.pizzaMetrics.sold++;
			this.pizzaMetrics.revenue += revenue;
		} else {
			this.pizzaMetrics.failures++;
		}

		this.latencyMetrics.pizzaLatencies.push(latency);

		// Keep only last 100 latencies
		if (this.latencyMetrics.pizzaLatencies.length > 100) {
			this.latencyMetrics.pizzaLatencies.shift();
		}
	}

	// Get system metrics
	getCpuUsagePercentage() {
		const cpuUsage = os.loadavg()[0] / os.cpus().length;
		return Math.min(cpuUsage * 100,100); // Cap at 100%
	}

	getMemoryUsagePercentage() {
		const totalMemory = os.totalmem();
		const freeMemory = os.freemem();
		const usedMemory = totalMemory - freeMemory;
		const memoryUsage = (usedMemory / totalMemory) * 100;
		return parseFloat(memoryUsage.toFixed(2));
	}

	// Calculate average latency
	getAverageLatency(latencies) {
		if (latencies.length === 0) return 0;
		const sum = latencies.reduce((a,b) => a + b,0);
		return Math.round(sum / latencies.length);
	}

	// Build and send metrics to Grafana
	async sendMetrics() {
		try {
			const now = Date.now();

			// Clean up inactive users (no activity in last 5 minutes)
			const fiveMinutesAgo = now - (5 * 60 * 1000);
			for (const [userId,lastActivityTime] of this.activeUsers) {
				if (lastActivityTime < fiveMinutesAgo) {
					this.activeUsers.delete(userId);
					console.log(`User ${userId} expired from active users (last activity: ${new Date(lastActivityTime).toISOString()})`);
				}
			}

			const metrics = {
				source: config.metrics.source,
				timestamp: now,

				// HTTP Request metrics (RATE - per period)
				http_requests_total: this.httpRequestCounts.total,
				http_requests_get: this.httpRequestCounts.GET || 0,
				http_requests_post: this.httpRequestCounts.POST || 0,
				http_requests_put: this.httpRequestCounts.PUT || 0,
				http_requests_delete: this.httpRequestCounts.DELETE || 0,

				// Authentication metrics (RATE - per period)
				auth_attempts_successful: this.authAttempts.successful,
				auth_attempts_failed: this.authAttempts.failed,

				// Active users (GAUGE - current state based on recent activity)
				active_users: this.activeUsers.size,

				// System metrics (GAUGE - current state)
				cpu_percent: this.getCpuUsagePercentage(),
				memory_percent: this.getMemoryUsagePercentage(),

				// Pizza metrics (RATE - per period)
				pizzas_sold: this.pizzaMetrics.sold,
				pizza_failures: this.pizzaMetrics.failures,
				pizza_revenue: this.pizzaMetrics.revenue,

				// Latency metrics (GAUGE - current averages)
				service_latency_avg: this.getAverageLatency(this.latencyMetrics.serviceLatencies),
				pizza_latency_avg: this.getAverageLatency(this.latencyMetrics.pizzaLatencies)
			};

			// Send to Grafana using OpenTelemetry format
			await this.sendToGrafana(metrics);

			// Reset only the RATE metrics for next period
			this.resetPeriodMetrics();

		} catch (error) {
			console.log('Error sending metrics',error);
		}
	}

	// Send metrics to Grafana Cloud
	async sendToGrafana(metrics) {
		try {
			// Log metrics locally for debugging
			console.log('Metrics collected:',JSON.stringify(metrics,null,2));

			// Build proper OpenTelemetry metrics payload
			const otlpPayload = this.buildOtelMetrics(metrics);

			// Use dynamic import for fetch in older Node versions
			const fetch = globalThis.fetch || (await import('node-fetch')).default;

			const response = await fetch(config.metrics.url,{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${config.metrics.apiKey}`
				},
				body: JSON.stringify(otlpPayload)
			});

			if (!response.ok) {
				const errorText = await response.text();
				console.error('Failed to send metrics:',response.status,response.statusText,errorText);
			} else {
				console.log('Metrics successfully sent to Grafana');
			}
		} catch (error) {
			console.error('Error sending metrics to Grafana:',error.message);
		}
	}

	// Build OpenTelemetry metrics format
	buildOtelMetrics(metrics) {
		const timestamp = Date.now() * 1000000; // Convert to nanoseconds
		const resource = {
			attributes: [
				{
					key: 'service.name',
					value: { stringValue: metrics.source }
				},
				{
					key: 'service.version',
					value: { stringValue: '1.0.0' }
				}
			]
		};

		const dataPoints = [];
		
		// Convert each metric to OTLP format
		Object.entries(metrics).forEach(([key,value]) => {
			if (key !== 'source' && key !== 'timestamp' && typeof value === 'number') {
				dataPoints.push({
					attributes: [
						{
							key: 'source',
							value: { stringValue: metrics.source }
						}
					],
					asDouble: value,
					timeUnixNano: timestamp
				});
			}
		});

		// Group metrics by type for better organization
		const metricsList = Object.entries(metrics)
			.filter(([key,value]) => key !== 'source' && key !== 'timestamp' && typeof value === 'number')
			.map(([key,value]) => ({
				name: key,
				description: `${key} metric from JWT Pizza Service`,
				unit: this.getMetricUnit(key),
				gauge: {
					dataPoints: [
						{
							attributes: [
								{
									key: 'source',
									value: { stringValue: metrics.source }
								}
							],
							asDouble: value,
							timeUnixNano: timestamp
						}
					]
				}
			}));

		return {
			resourceMetrics: [
				{
					resource: resource,
					scopeMetrics: [
						{
							scope: {
								name: 'jwt-pizza-service-metrics',
								version: '1.0.0'
							},
							metrics: metricsList
						}
					]
				}
			]
		};
	}

	// Get appropriate unit for each metric
	getMetricUnit(metricName) {
		if (metricName.includes('percent')) return '%';
		if (metricName.includes('latency')) return 'ms';
		if (metricName.includes('revenue')) return 'USD';
		if (metricName.includes('requests') || metricName.includes('attempts') || metricName.includes('users') || metricName.includes('pizzas')) return '1';
		return '1'; // dimensionless
	}

	// Reset metrics that should be counted per period
	resetPeriodMetrics() {
		// Reset RATE metrics (per-minute counters)
		this.httpRequestCounts = {
			total: 0,
			GET: 0,
			POST: 0,
			PUT: 0,
			DELETE: 0
		};

		// Reset auth attempts (per-minute counters)
		this.authAttempts = {
			successful: 0,
			failed: 0
		};

		// Reset pizza metrics (per-minute counters)
		this.pizzaMetrics = {
			sold: 0,
			failures: 0,
			revenue: 0
		};

		// Clear latency arrays (but keep recent samples for averaging)
		if (this.latencyMetrics.serviceLatencies.length > 50) {
			this.latencyMetrics.serviceLatencies = this.latencyMetrics.serviceLatencies.slice(-50);
		}
		if (this.latencyMetrics.pizzaLatencies.length > 50) {
			this.latencyMetrics.pizzaLatencies = this.latencyMetrics.pizzaLatencies.slice(-50);
		}

		// DON'T reset active users - they should persist across reporting periods
		// DON'T reset system metrics - they are current state gauges
	}

	// Start periodic metrics reporting
	startMetricsReporting() {
		// Send metrics every 30 seconds
		setInterval(() => {
			this.sendMetrics();
		},30000);
	}
}

// Export singleton instance
module.exports = new Metrics();