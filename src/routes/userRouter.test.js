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
  // Wait for DB initialization
  await DB.initialized;
  
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

test('list users unauthorized', async () => {
	const listUsersRes = await request(app).get('/api/user');
	expect(listUsersRes.status).toBe(401);
});

test('GET /api/user - admin can list users with pagination and filtering', async () => {
	// Test basic listing
	const basicRes = await request(app)
		.get('/api/user')
		.set('Authorization', `Bearer ${adminAuthToken}`);
	expect(basicRes.status).toBe(200);
	expect(basicRes.body).toHaveProperty('users');
	expect(Array.isArray(basicRes.body.users)).toBe(true);
	expect(basicRes.body).toHaveProperty('more');

	// Test pagination
	const paginationRes = await request(app)
		.get('/api/user?page=0&limit=5')
		.set('Authorization', `Bearer ${adminAuthToken}`);
	expect(paginationRes.status).toBe(200);
	expect(paginationRes.body.users.length).toBeLessThanOrEqual(5);

	// Test name filtering
	const filterRes = await request(app)
		.get('/api/user?name=pizza')
		.set('Authorization', `Bearer ${adminAuthToken}`);
	expect(filterRes.status).toBe(200);
	expect(Array.isArray(filterRes.body.users)).toBe(true);
});

test('GET /api/user - regular user cannot list users', async () => {
  const res = await request(app)
    .get('/api/user')
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(res.status).toBe(403);
  expect(res.body).toMatchObject({ message: 'unauthorized' });
});

test('DELETE /api/user/:userId - admin can delete another user', async () => {
  // Create a user to delete
  const userToDelete = {
    name: 'User to Delete',
    email: randomName() + '@delete.com',
    password: 'deletepass'
  };
  
  const createRes = await request(app)
    .post('/api/auth')
    .send(userToDelete);
  
  expect(createRes.status).toBe(200);
  const userToDeleteId = createRes.body.user.id;

  // Delete the user as admin
  const deleteRes = await request(app)
    .delete(`/api/user/${userToDeleteId}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);

  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body).toMatchObject({ message: 'User deleted successfully' });

  // Verify user was deleted by trying to list users and checking they're not there
  const listRes = await request(app)
    .get('/api/user')
    .set('Authorization', `Bearer ${adminAuthToken}`);
  
  const deletedUser = listRes.body.users.find(u => u.id === userToDeleteId);
  expect(deletedUser).toBeUndefined();
});

test('DELETE /api/user/:userId - admin cannot delete themselves', async () => {
  const res = await request(app)
    .delete(`/api/user/${adminUser.id}`)
    .set('Authorization', `Bearer ${adminAuthToken}`);

  expect(res.status).toBe(400);
  expect(res.body).toMatchObject({ message: 'Cannot delete your own account' });
});

test('DELETE /api/user/:userId - authorization tests', async () => {
	// Test regular user cannot delete other users
	const deleteOtherRes = await request(app)
		.delete(`/api/user/${adminUser.id}`)
		.set('Authorization', `Bearer ${testUserAuthToken}`);
	expect(deleteOtherRes.status).toBe(403);
	expect(deleteOtherRes.body).toMatchObject({ message: 'unauthorized' });

	// Test regular user cannot delete themselves through this endpoint
	const deleteSelfRes = await request(app)
		.delete(`/api/user/${testUserId}`)
		.set('Authorization', `Bearer ${testUserAuthToken}`);
	expect(deleteSelfRes.status).toBe(403);
	expect(deleteSelfRes.body).toMatchObject({ message: 'unauthorized' });
});
