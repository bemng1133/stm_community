const SteamCommunity = require('../index.js');

SteamCommunity.prototype.httpRequest = async function (uri, options, callback, source) {
	if (typeof uri === 'object') {
		source = callback;
		callback = options;
		options = uri;
		uri = options.url || options.uri;
	} else if (typeof options === 'function') {
		source = callback;
		callback = options;
		options = {};
	}

	options.url = options.uri = uri;

	if (this._httpRequestConvenienceMethod) {
		options.method = this._httpRequestConvenienceMethod;
		delete this._httpRequestConvenienceMethod;
	}

	var requestID = ++this._httpRequestID;
	source = source || "";

	var self = this;
	var continued = false;

	if (!this.onPreHttpRequest || !this.onPreHttpRequest(requestID, source, options, continueRequest)) {
		// No pre-hook, or the pre-hook doesn't want to delay the request.
		continueRequest(null);
	}

	function handleResponse(err, response, body) {
		let hasCallback = !!callback;
		let httpError = options.checkHttpError !== false && self._checkHttpError(err, response, callback, body);
		let communityError = !options.json && options.checkCommunityError !== false && self._checkCommunityError(body, httpError ? function () { } : callback);
		let tradeError = !options.json && options.checkTradeError !== false && self._checkTradeError(body, httpError || communityError ? function () { } : callback);
		let jsonError = options.json && options.checkJsonError !== false && !body ? new Error("Malformed JSON response") : null;

		self.emit('postHttpRequest', requestID, source, options, httpError || communityError || tradeError || jsonError || null, response, body, {
			"hasCallback": hasCallback,
			"httpError": httpError,
			"communityError": communityError,
			"tradeError": tradeError,
			"jsonError": jsonError
		});

		if (hasCallback && !(httpError || communityError || tradeError)) {
			if (jsonError) {
				callback.call(self, jsonError, response);
			} else {
				callback.apply(self, arguments);
			}
		}
	}

	async function continueRequest(err) {
		if (continued) {
			return;
		}

		continued = true;

		if (err) {
			if (callback) {
				callback(err);
			}

			return;
		}



		if (self._useCycleTLS) {
			try {
				let cycleTLSUrl = options.url || uri;
				if (cycleTLSUrl.startsWith('https://')) {
					cycleTLSUrl = `http://${cycleTLSUrl.substr(8)}`;
				}

				const cycleTLSOptions = {
					...self._cycleTLSOptions,
					...options,
					url: cycleTLSUrl,
					method: options.method || 'get',
					body: options.body || '',
					headers: options.headers || {},
				};

				// Get cookies for all Steam domains
				const cookieObj = await self._getCookiesForSteamDomains(uri);

				if (Object.keys(cookieObj).length > 0) {
					cycleTLSOptions.cookies = cookieObj;
				}

				// If cookies were sent in headers, merge them
				if (cycleTLSOptions.headers.cookie) {
					const headerCookies = cycleTLSOptions.headers.cookie.split('; ').reduce((acc, cur) => {
						const [key, value] = cur.split('=');
						acc[key] = value;
						return acc;
					}, {});
					cycleTLSOptions.cookies = { ...cycleTLSOptions.cookies, ...headerCookies };
					cycleTLSOptions.headers.cookie = undefined;
				}

				// Wait for CycleTLS to initialize
				await self._cycleTLSInitPromise;//todo remove this
				// console.log(cycleTLSOptions)
				console.log('making req')
				const response = await self._cycleTLS(cycleTLSOptions.url, cycleTLSOptions, cycleTLSOptions.method);
				console.log('req made')
				// Update jar with any new cookies from the response
				await self._updateJarFromCycleTLSResponse(response, uri);

				// Handle JSON responses
				let responseBody = response.body;
				if (typeof responseBody === 'object' && responseBody !== null && !options.json) {
					responseBody = JSON.stringify(responseBody);
				} else if (options.json && typeof responseBody === 'string') {
					try {
						responseBody = JSON.parse(responseBody);
					} catch (e) {
						// If parsing fails, leave the body as is
					}
				}


				handleResponse(null, { statusCode: response.status, headers: response.headers }, responseBody);
			} catch (error) {
				handleResponse(error);
			}
		} else {
			self.request(options, handleResponse);
		}

	}
}

SteamCommunity.prototype._updateJarFromCycleTLSResponse = async function (response, uri) {
	if (response.headers['set-cookie']) {
		const cookies = Array.isArray(response.headers['set-cookie'])
			? response.headers['set-cookie']
			: [response.headers['set-cookie']];

		for (const cookieString of cookies) {
			const cookie = Request.cookie(cookieString);
			await this._setCookie(cookie, cookie.secure);
		}
	}
};

SteamCommunity.prototype._getCookiesForSteamDomains = async function (uri) {
	const steamDomains = [
		'steamcommunity.com',
		'store.steampowered.com',
		'help.steampowered.com'
	];

	let cookieObj = {};

	for (const domain of steamDomains) {
		const url = new URL(uri);
		url.hostname = domain;
		const cookies = await this._jar.getCookies(url.toString());
		cookies.forEach(cookie => {
			cookieObj[cookie.key] = cookie.value;
		});
	}

	return cookieObj;
};

SteamCommunity.prototype.httpRequestGet = function () {
	this._httpRequestConvenienceMethod = "GET";
	return this.httpRequest.apply(this, arguments);
};

SteamCommunity.prototype.httpRequestPost = function () {
	this._httpRequestConvenienceMethod = "POST";
	return this.httpRequest.apply(this, arguments);
};

SteamCommunity.prototype._notifySessionExpired = function (err) {
	this.emit('sessionExpired', err);
};

SteamCommunity.prototype._checkHttpError = function (err, response, callback, body) {
	if (err) {
		callback(err, response, body);
		return err;
	}

	if (response.statusCode >= 300 && response.statusCode <= 399 && response.headers.location.indexOf('/login') != -1) {
		err = new Error("Not Logged In");
		callback(err, response, body);
		this._notifySessionExpired(err);
		return err;
	}

	if (response.statusCode == 403 && typeof response.body === 'string' && response.body.match(/<div id="parental_notice_instructions">Enter your PIN below to exit Family View.<\/div>/)) {
		err = new Error("Family View Restricted");
		callback(err, response, body);
		return err;
	}

	if (response.statusCode >= 400) {
		err = new Error("HTTP error " + response.statusCode);
		err.code = response.statusCode;
		callback(err, response, body);
		return err;
	}

	return false;
};

SteamCommunity.prototype._checkCommunityError = function (html, callback) {
	var err;

	if (typeof html === 'string' && html.match(/<h1>Sorry!<\/h1>/)) {
		var match = html.match(/<h3>(.+)<\/h3>/);
		err = new Error(match ? match[1] : "Unknown error occurred");
		callback(err);
		return err;
	}

	if (typeof html === 'string' && html.indexOf('g_steamID = false;') > -1 && html.indexOf('<title>Sign In</title>') > -1) {
		err = new Error("Not Logged In");
		callback(err);
		this._notifySessionExpired(err);
		return err;
	}

	return false;
};

SteamCommunity.prototype._checkTradeError = function (html, callback) {
	if (typeof html !== 'string') {
		return false;
	}

	var match = html.match(/<div id="error_msg">\s*([^<]+)\s*<\/div>/);
	if (match) {
		var err = new Error(match[1].trim());
		callback(err);
		return err;
	}

	return false;
};
