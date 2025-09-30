const request = require('supertest');
const app = require('../service');

const testUser = { name: 'pizza diner', email: 'reg@test.com',password: 'a' };
let testUserAuthToken;

const DB = {
	isLoggedIn: jest.fn(),
};

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

	// Mock DB.isLoggedIn to return true
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
	expect(req.user).toBeNull();
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

function expectValidJwt(potentialJwt) {
	expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}