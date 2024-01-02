
/**
 * @typedef {import('redis').RedisClientType} RedisClientType
 */
/**
 * @typedef {object} RedconfOptions
 * @property {RedisClientType} redisClient Redis client.
 * @property {RedisClientType | undefined} redisSubClient Redis client for subscriptions. If not specified, redisClient will be duplicated.
 * @property {string} namespace Configuration namespace.
 * @property {{ [key: string]: () => any }} schema Validation schema. Each value must be a function that receives a value and returns a validated value or throws an error.
 */

const REDIS_PREFIX = '@redconf:';
const SYMBOL_SAFETY = Symbol('no-new');

export class Redconf {
	/**
	 * @type {RedisClientType} Redis client.
	 */
	#redisClient;
	/**
	 * @type {RedisClientType} Redis client for subscriptions.
	 */
	#redisSubClient;
	/**
	 * @type {string} Configuration namespace.
	 */
	#namespace;
	/**
	 * @type {string} Redis key for storing configuration.
	 */
	#redis_key;
	/**
	 * @type {Map<string, () => any>} Configuration schema.
	 */
	#schema = {};

	/**
	 * @type {Map<string, any>} Configuration storage.
	 */
	#storage = new Map();

	constructor(
		{
			redisClient,
			redisSubClient,
			namespace,
			schema,
		},
		symbol_safety,
		callback,
	) {
		if (symbol_safety !== SYMBOL_SAFETY) {
			throw new TypeError('Redconf is not a constructor. Use createRedconf() method instead.');
		}

		this.#redisClient = redisClient;
		this.#redisSubClient = redisSubClient ?? redisClient.duplicate();

		this.#namespace = namespace;
		this.#redis_key = REDIS_PREFIX + namespace;

		// this.#schema = schema;
		for (const [ key, validator ] of Object.entries(schema)) {
			if (typeof validator !== 'function') {
				throw new TypeError(`Schema validator for key "${key}" is not a function.`);
			}

			this.#schema[key] = (value) => {
				try {
					return validator(value);
				}
				// eslint-disable-next-line unicorn/catch-error-name
				catch (error_original) {
					const error = new Error(`Invalid value for key "${key}": ${error_original.message}`);
					error.original = error_original;
					throw error;
				}
			};
		}

		setTimeout(() => callback(
			this.#init(),
		));
	}

	/**
	 * Initializes Redconf instance.
	 * @private
	 */
	async #init() {
		await this.#redisSubClient.connect();

		await this.#redisSubClient.subscribe(
			this.#redis_key,
			() => {
				this.#reload().catch(console.error);
			},
		);

		await this.#reload();
	}

	/**
	 * Fetches actual configuration from Redis.
	 * @private
	 */
	async #reload() {
		const values = await this.#redisClient.sendCommand([ 'HGETALL', this.#redis_key ]);

		this.#storage.clear();

		for (let index = 0; index < values.length; index += 2) {
			const key = values[index];

			const validator = this.#schema[key];
			if (typeof validator === 'function') {
				const value = validator(
					values[index + 1],
				);

				this.#storage.set(
					key,
					value,
				);
			}
			else {
				console.warn(`[redconf] Unknown configuration key "${key}" in namespace "${this.#namespace}".`);
			}
		}
	}

	get(key) {
		return this.#storage.get(key);
	}

	mget(...keys) {
		const values = new Map();

		for (const key of keys) {
			values.set(
				key,
				this.#storage.get(key),
			);
		}

		return values;
	}

	async set(key, value) {
		const schemaValidator = this.#schema[key];
		if (undefined === schemaValidator) {
			throw new Error(`Unknown configuration key "${key}".`);
		}

		value = schemaValidator(value);

		this.#storage.set(
			key,
			this.#schema[key](value),
		);

		await this.#redisClient.MULTI()
			.addCommand([
				'HSET',
				this.#redis_key,
				key,
				String(value),
			])
			.addCommand([
				'PUBLISH',
				this.#redis_key,
				'',
			])
			.EXEC();
	}
}

/**
 * Creates Redconf instance.
 * @async
 * @param {RedconfOptions} options -
 * @returns {Promise<Redconf>} Redconf instance.
 */
export async function createRedconf(options) {
	const [
		redconf,
		init_promise,
	] = await new Promise((resolve) => {
		const redconf = new Redconf(
			options,
			SYMBOL_SAFETY,
			(init_promise) => resolve([
				redconf,
				init_promise,
			]),
		);
	});

	await init_promise;

	return redconf;
}
