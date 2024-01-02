
/* global test, expect */

import { createClient } from 'redis';
import {
	coerce,
	maxLength,
	minValue,
	minLength,
	number,
	parse,
	string }            from 'valibot';
import {
	createRedconf,
	Redconf }           from './main.js';

function createValidator(validator) {
	return (value) => parse(validator, value);
}

const redisClient = createClient({
	socket: {
		port: 51934,
	},
});
await redisClient.connect();

const redisSecondClient = redisClient.duplicate();
await redisSecondClient.connect();

await redisClient.MULTI()
	.FLUSHDB()
	.addCommand([
		'HSET',
		'@redconf:test',
		'user_id',
		'1',
		'nick',
		'kirick',
	])
	.EXEC();

let redconf;

test('create instance', async () => {
	redconf = await createRedconf({
		redisClient,
		namespace: 'test',
		schema: {
			user_id: createValidator(
				coerce(
					number([
						minValue(0),
					]),
					Number.parseInt,
				),
			),
			nick: createValidator(
				string([
					minLength(1),
					maxLength(32),
				]),
			),
		},
	});

	expect(redconf).toBeInstanceOf(Redconf);
});

test('get value', () => {
	expect(
		redconf.get('user_id'),
	).toBe(1);

	expect(
		redconf.get('nick'),
	).toBe('kirick');
});

test('get multiple values', () => {
	expect(
		redconf.mget(
			'user_id',
			'nick',
		),
	).toStrictEqual(
		new Map([
			[ 'user_id', 1 ],
			[ 'nick', 'kirick' ],
		]),
	);
});

test('update value', async () => {
	await redconf.set('user_id', '2');

	expect(
		redconf.get('user_id'),
	).toBe(2);
});

test('receive update', async () => {
	await redisSecondClient.MULTI()
		.addCommand([
			'HSET',
			'@redconf:test',
			'user_id',
			'3',
		])
		.addCommand([
			'PUBLISH',
			'@redconf:test',
			'',
		])
		.EXEC();

	await new Promise((resolve) => {
		setTimeout(resolve, 10);
	});

	expect(
		redconf.get('user_id'),
	).toBe(3);
});
