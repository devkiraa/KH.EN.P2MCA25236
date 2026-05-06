const axios = require('axios');
const dotenv = require('dotenv');

dotenv.config();

const LOG_API_URL = process.env.LOG_API_URL || 'http://20.244.56.144/evaluation-service/logs';

const allowedStacks = new Set(['backend', 'frontend']);
const allowedLevels = new Set(['debug', 'info', 'warn', 'error', 'fatal']);
const sharedPackages = new Set(['auth', 'config', 'middleware', 'utils']);
const backendPackages = new Set(['cache', 'controller', 'cron_job', 'db', 'domain', 'handler', 'repository', 'route', 'service']);
const frontendPackages = new Set(['api', 'component', 'hook', 'page', 'state', 'style']);

let currentToken = process.env.ACCESS_TOKEN || process.env.API_TOKEN || '';

const setAuthToken = (token) => {
	currentToken = String(token || '').trim();
};

const isValidPackage = (stack, packageName) => {
	if (sharedPackages.has(packageName)) {
		return true;
	}

	if (stack === 'backend') {
		return backendPackages.has(packageName);
	}

	if (stack === 'frontend') {
		return frontendPackages.has(packageName);
	}

	return false;
};

const normalizeError = (error) => {
	if (error && error.response) {
		return {
			ok: false,
			statusCode: error.response.status,
			body: error.response.data
		};
	}

	return {
		ok: false,
		statusCode: 0,
		error: error && error.message ? error.message : 'unknown_error'
	};
};

const Log = async (stack, level, packageName, message) => {
	if (!allowedStacks.has(stack)) {
		return { ok: false, statusCode: 0, error: 'invalid_stack' };
	}

	if (!allowedLevels.has(level)) {
		return { ok: false, statusCode: 0, error: 'invalid_level' };
	}

	if (!isValidPackage(stack, packageName)) {
		return { ok: false, statusCode: 0, error: 'invalid_package' };
	}

	try {
		const response = await axios.post(
			LOG_API_URL,
			{
				stack,
				level,
				package: packageName,
				message
			},
			{
				headers: {
					Authorization: `Bearer ${currentToken}`,
					'Content-Type': 'application/json'
				},
				timeout: 15000
			}
		);

		console.log('Log created:', response.data);

		return {
			ok: true,
			statusCode: response.status,
			body: response.data
		};
	} catch (error) {
		console.error('Logger failed');
		return normalizeError(error);
	}
};

module.exports = {
	Log,
	setAuthToken
};