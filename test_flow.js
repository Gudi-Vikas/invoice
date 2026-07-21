const API_BASE = 'http://localhost:5000/api/v1';

async function test() {
  // 1. Signup
  const email = 'test' + Date.now() + '@example.com';
  console.log('Signing up with', email);
  let res = await fetch(`${API_BASE}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Tenant 1', domain: 't1-' + Date.now(), email, password: 'password123' })
  });
  let data = await res.json();
  if (!res.ok) { console.error('Signup failed', data); return; }
  let token = data.token;
  let activeTenant = data.activeTenant;
  console.log('Signup OK, activeTenant:', activeTenant.id);

  // 2. Create new tenant
  console.log('Creating new tenant');
  res = await fetch(`${API_BASE}/auth/create-tenant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-tenant-id': activeTenant.id
    },
    body: JSON.stringify({ name: 'Tenant 2', domain: 't2-' + Date.now() })
  });
  let data2 = await res.json();
  if (!res.ok) { console.error('Create tenant failed', data2); return; }
  let token2 = data2.token;
  let activeTenant2 = data2.activeTenant;
  console.log('Create tenant OK, new activeTenant:', activeTenant2.id);

  // 3. Switch back to original tenant
  console.log('Switching to', activeTenant.id, 'using new token', token2);
  res = await fetch(`${API_BASE}/auth/switch-tenant`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token2}`,
      'x-tenant-id': activeTenant2.id
    },
    body: JSON.stringify({ tenantId: activeTenant.id })
  });
  let data3 = await res.json();
  if (!res.ok) { console.error('Switch failed:', res.status, data3); return; }
  console.log('Switch OK, returned activeTenant:', data3.activeTenant.id);
}

test().catch(console.error);
