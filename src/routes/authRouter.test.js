const request = require('supertest');
const app = require('../service');
const { setAuthUser, authRouter } = require('./authRouter');

const testUser = { name: 'pizza diner', email: 'reg@test.com',password: 'a' };
let testUserAuthToken;

const { DB } = require('../database/database.js');

beforeAll(async () => {
	testUser.email = Math.random().toString(36).substring(2,12) + '@test.com';
	const registerRes = await request(app).post('/api/auth').send(testUser);
	testUserAuthToken = registerRes.body.token;
	expectValidJwt(testUserAuthToken);
});

test('login', async () => {
	const loginRes = await request(app).put('/api/auth').send(testUser);
	expect(loginRes.status).toBe(200);
	expectValidJwt(loginRes.body.token);

	const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
	delete expectedUser.password;
	expect(loginRes.body.user).toMatchObject(expectedUser);
});

test('setAuthUser - valid token', async () => {
	const validToken = testUserAuthToken;
	const req = {
		headers: { authorization: `Bearer ${validToken}` },
	};
	const res = {};
	const next = jest.fn();

	jest.spyOn(DB,'isLoggedIn').mockResolvedValue(true);
	await setAuthUser(req, res, next);

	expect(DB.isLoggedIn).toHaveBeenCalledWith(validToken);
	expect(req.user).toBeDefined();
	expect(req.user.email).toBe(testUser.email);
	expect(req.user.isRole).toBeInstanceOf(Function);
	expect(next).toHaveBeenCalled();
});

test('setAuthUser - invalid token',async () => {
	const invalidToken = 'invalidToken';
	const req = {
		headers: { authorization: `Bearer ${invalidToken}` },
	};
	const res = {};
	const next = jest.fn();

	// Mock DB.isLoggedIn to return false
	jest.spyOn(DB,'isLoggedIn').mockResolvedValue(false);
	await setAuthUser(req,res,next);

	expect(DB.isLoggedIn).toHaveBeenCalledWith(invalidToken);
	expect(req.user).toBeUndefined();
	expect(next).toHaveBeenCalled();
});

test('setAuthUser - no token',async () => {
	const req = { headers: {} };
	const res = {};
	const next = jest.fn();

	await setAuthUser(req, res, next);

	expect(req.user).toBeUndefined();
	expect(next).toHaveBeenCalled();
});

test('authenticateToken - authorized user', () => {
	const req = { user: { email: testUser.email } };
	const res = {};
	const next = jest.fn();

	authRouter.authenticateToken(req, res, next);

	expect(next).toHaveBeenCalled();
});

test('authenticateToken - unauthorized user', () => {
	const req = {};
	const res = {
		status: jest.fn().mockReturnThis(),
		send: jest.fn(),
	};
	const next = jest.fn();

	authRouter.authenticateToken(req, res, next);

	expect(res.status).toHaveBeenCalledWith(401);
	expect(res.send).toHaveBeenCalledWith({ message: 'unauthorized' });
	expect(next).not.toHaveBeenCalled();
});

test('register - missing fields', async () => {
	const missingFields = [
		{ email: 'test@test.com', password: 'password' }, // Missing name
		{ name: 'Test User', password: 'password' }, // Missing email
		{ name: 'Test User', email: 'test@test.com' }, // Missing password
	];

	for (const body of missingFields) {
		const res = await request(app).post('/api/auth').send(body);
		expect(res.status).toBe(400);
		expect(res.body).toEqual({ message: 'name, email, and password are required' });
	}
});

test('logout - authorized user', async () => {
	jest.spyOn(DB,'isLoggedIn').mockResolvedValue(true);
	const res = await request(app)
		.delete('/api/auth')
		.set('Authorization', `Bearer ${testUserAuthToken}`);

	expect(res.status).toBe(200);
	expect(res.body).toEqual({ message: 'logout successful' });
});

test('logout - unauthorized user', async () => {
	const res = await request(app).delete('/api/auth');

	expect(res.status).toBe(401);
	expect(res.body).toEqual({ message: 'unauthorized' });
});

function expectValidJwt(potentialJwt) {
	expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}