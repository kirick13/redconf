var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.js
var main_exports = {};
__export(main_exports, {
  Redconf: () => Redconf,
  createRedconf: () => createRedconf
});
module.exports = __toCommonJS(main_exports);
var REDIS_PREFIX = "@redconf:";
var SYMBOL_SAFETY = Symbol("no-new");
var Redconf = class {
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
  #storage = /* @__PURE__ */ new Map();
  constructor({
    redisClient,
    redisSubClient,
    namespace,
    schema
  }, symbol_safety, callback) {
    if (symbol_safety !== SYMBOL_SAFETY) {
      throw new TypeError("Redconf is not a constructor. Use createRedconf() method instead.");
    }
    this.#redisClient = redisClient;
    this.#redisSubClient = redisSubClient ?? redisClient.duplicate();
    this.#namespace = namespace;
    this.#redis_key = REDIS_PREFIX + namespace;
    for (const [key, validator] of Object.entries(schema)) {
      if (typeof validator !== "function") {
        throw new TypeError(`Schema validator for key "${key}" is not a function.`);
      }
      this.#schema[key] = (value) => {
        try {
          return validator(value);
        } catch (error_original) {
          const error = new Error(`Invalid value for key "${key}": ${error_original.message}`);
          error.original = error_original;
          throw error;
        }
      };
    }
    setTimeout(() => callback(
      this.#init()
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
      }
    );
    await this.#reload();
  }
  /**
   * Fetches actual configuration from Redis.
   * @private
   */
  async #reload() {
    const values = await this.#redisClient.sendCommand(["HGETALL", this.#redis_key]);
    this.#storage.clear();
    for (let index = 0; index < values.length; index += 2) {
      const key = values[index];
      const validator = this.#schema[key];
      if (typeof validator === "function") {
        const value = validator(
          values[index + 1]
        );
        this.#storage.set(
          key,
          value
        );
      } else {
        console.warn(`[redconf] Unknown configuration key "${key}" in namespace "${this.#namespace}".`);
      }
    }
  }
  get(key) {
    return this.#storage.get(key);
  }
  mget(...keys) {
    const values = /* @__PURE__ */ new Map();
    for (const key of keys) {
      values.set(
        key,
        this.#storage.get(key)
      );
    }
    return values;
  }
  async set(key, value) {
    const schemaValidator = this.#schema[key];
    if (void 0 === schemaValidator) {
      throw new Error(`Unknown configuration key "${key}".`);
    }
    value = schemaValidator(value);
    this.#storage.set(
      key,
      this.#schema[key](value)
    );
    await this.#redisClient.MULTI().addCommand([
      "HSET",
      this.#redis_key,
      key,
      String(value)
    ]).addCommand([
      "PUBLISH",
      this.#redis_key,
      ""
    ]).EXEC();
  }
};
async function createRedconf(options) {
  const [
    redconf,
    init_promise
  ] = await new Promise((resolve) => {
    const redconf2 = new Redconf(
      options,
      SYMBOL_SAFETY,
      (init_promise2) => resolve([
        redconf2,
        init_promise2
      ])
    );
  });
  await init_promise;
  return redconf;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Redconf,
  createRedconf
});
