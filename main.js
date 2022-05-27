
const RedisClient = require('@kirick/redis-client/src/client');

const REDIS_PREFIX = 'redconf:';
const REDIS_CHANNEL = 'redconf-updated';

class Redconf {
	constructor ({
		redisClient,
		redisSubClient,
		namespace,
		props,
	}) {
		this.namespace = namespace;

		this._redis_key = REDIS_PREFIX + namespace;

		if (redisClient instanceof RedisClient !== true) {
			throw new TypeError(`Option 'redisClient' must be an instance of RedisClient of @kirick/redis-client package (namespace "${namespace}").`);
		}
		this._redisClient = redisClient;

		if (
			undefined !== redisSubClient
			&& redisSubClient instanceof RedisClient !== true
		) {
			throw new TypeError(`Option 'redisSubClient' must be an instance of RedisClient of @kirick/redis-client package or undefined (namespace "${namespace}").`);
		}
		this._redisSubClient = redisSubClient ?? redisClient.duplicate();

		if (props.constructor.name !== 'OhMyProps') {
			throw new Error('Argument "props" is not an instance of OhMyProps.');
		}
		this._ohmyprops = props;

		this.storage = new Map();

		this._promise_ready = this.reload().catch(console.error);

		this._subscribe();
	}

	get (key) {
		return this.storage.get(key);
	}

	mget (...keys) {
		const values = new Map();

		for (const key of keys) {
			values.set(
				key,
				this.storage.get(key),
			);
		}

		return values;
	}

	async reload () {
		const rdata_redis = await this._redisClient.hgetall(this._redis_key) ?? [];

		const data = this._ohmyprops.transform(rdata_redis);
		// console.log('[REDCONF] data reloaded', this.namespace, data);
		if (null === data) {
			console.error('[REDCONF] namespace', this.namespace);
			console.error('[REDCONF] props', this._ohmyprops.props);
			console.error('[REDCONF] redis data', rdata_redis);

			throw new Error(`[REDCONF] Invalid argument detected at "${this.namespace}" namespace. Please re-check your database.`);
		}
		else {
			this.storage.clear();
			for (const [ key, value ] of Object.entries(data)) {
				this.storage.set(key, value);
			}
		}
	}

	set (key, value) {
		const data = Object.fromEntries(
			this.storage.entries(),
		);
		data[key] = value;

		if (!this._ohmyprops.isValid(data)) {
			throw new Error(`[REDCONF] Invalid value "${value}" given for key "${key}".`);
		}

		this._redisClient.multi()
			.hset(
				this._redis_key,
				key,
				value,
			)
			.publish(
				REDIS_CHANNEL,
				this.namespace,
			)
		.exec()
		.catch(console.error);
	}

	onReady (cb) {
		if (cb) {
			this._promise_ready.then(cb).catch(console.error); // eslint-disable-line promise/no-callback-in-promise
		}
		else {
			return this._promise_ready;
		}
	}

	_subscribe () {
		this._redisSubClient.subscribe(
			REDIS_CHANNEL,
			(message) => {
				if (message === this.namespace) {
					this.reload()
					.catch(console.error);
				}
			},
		);
	}
}

module.exports = Redconf;
