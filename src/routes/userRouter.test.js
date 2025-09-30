const request = require('supertest');
const app = require('../service');
const { DB, Role } = require('../database/database');

function randomName() {
  return Math.random().toString(36).substring(2, 10);
}

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;
let testUserId;

let adminUser;
let adminAuthToken;

async function createAdminUser() {
  let user = { password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  user.name = randomName();
  user.email = `${user.name}@admin.com`;
  user = await DB.addUser(user);
  return { ...user, password: 'toomanysecrets' };
}

beforeAll(async () => {
  // register a regular test user
  testUser.email = randomName() + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);

  const meRes = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${testUserAuthToken}`);
  testUserId = meRes.body.id;

  // create an admin user
  adminUser = await createAdminUser();
  const adminLoginRes = await request(app)
    .put('/api/auth')
    .send({ email: adminUser.email, password: adminUser.password });
  adminAuthToken = adminLoginRes.body.token;
  expectValidJwt(adminAuthToken);
});

test('GET /api/user/me - returns authenticated user info', async () => {
  const res = await request(app)
    .get('/api/user/me')
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('id', testUserId);
  expect(res.body).toHaveProperty('email', testUser.email);
});

test('PUT /api/user/:userId - user can update their own account', async () => {
  const newName = 'Updated Name ' + randomName();
  const res = await request(app)
    .put(`/api/user/${testUserId}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({ name: newName, email: testUser.email, password: testUser.password });

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('user');
  expect(res.body.user).toHaveProperty('name', newName);
  expect(res.body).toHaveProperty('token');
  expectValidJwt(res.body.token);
});

test('PUT /api/user/:userId - user cannot update another user without admin role', async () => {
  const res = await request(app)
    .put(`/api/user/${adminUser.id}`) // try to update admin as a normal user
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({ name: 'Hack Attempt', email: adminUser.email, password: '123' });

  expect(res.status).toBe(403);
  expect(res.body).toMatchObject({ message: 'unauthorized' });
});

test('PUT /api/user/:userId - admin can update another user', async () => {
  const newEmail = randomName() + '@updated.com';
  const res = await request(app)
    .put(`/api/user/${testUserId}`)
    .set('Authorization', `Bearer ${adminAuthToken}`)
    .send({ name: testUser.name, email: newEmail, password: testUser.password });

  expect(res.status).toBe(200);
  expect(res.body).toHaveProperty('user');
  expect(res.body.user).toHaveProperty('email', newEmail);
  expect(res.body).toHaveProperty('token');
  expectValidJwt(res.body.token);
});
