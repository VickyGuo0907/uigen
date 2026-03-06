// @vitest-environment node
import { test, expect, vi, beforeEach } from "vitest";
import { SignJWT } from "jose";

// Mock server-only (no-op)
vi.mock("server-only", () => ({}));

// Mock cookie store
const mockCookieStore = {
  set: vi.fn(),
  get: vi.fn(),
  delete: vi.fn(),
};

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => Promise.resolve(mockCookieStore)),
}));

const JWT_SECRET = new TextEncoder().encode("development-secret-key");

// Import after mocks are set up
const { createSession, getSession, deleteSession, verifySession } =
  await import("@/lib/auth");

beforeEach(() => {
  vi.clearAllMocks();
});

test("createSession sets an httpOnly cookie with a valid JWT", async () => {
  await createSession("user-123", "test@example.com");

  expect(mockCookieStore.set).toHaveBeenCalledOnce();
  const [name, token, options] = mockCookieStore.set.mock.calls[0];

  expect(name).toBe("auth-token");
  expect(typeof token).toBe("string");
  expect(options.httpOnly).toBe(true);
  expect(options.sameSite).toBe("lax");
  expect(options.path).toBe("/");
  expect(options.expires).toBeInstanceOf(Date);

  // Verify the expiry is ~7 days from now
  const expiresIn = options.expires.getTime() - Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  expect(expiresIn).toBeGreaterThan(sevenDaysMs - 5000);
  expect(expiresIn).toBeLessThanOrEqual(sevenDaysMs);
});

test("createSession produces a JWT containing userId and email", async () => {
  const { jwtVerify } = await import("jose");

  await createSession("user-456", "alice@example.com");

  const token = mockCookieStore.set.mock.calls[0][1];
  const { payload } = await jwtVerify(token, JWT_SECRET);

  expect(payload.userId).toBe("user-456");
  expect(payload.email).toBe("alice@example.com");
  expect(payload.exp).toBeDefined();
  expect(payload.iat).toBeDefined();
});

test("getSession returns session payload when a valid token exists", async () => {
  const token = await new SignJWT({
    userId: "user-789",
    email: "bob@example.com",
    expiresAt: new Date().toISOString(),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setIssuedAt()
    .sign(JWT_SECRET);

  mockCookieStore.get.mockReturnValue({ value: token });

  const session = await getSession();

  expect(session).not.toBeNull();
  expect(session!.userId).toBe("user-789");
  expect(session!.email).toBe("bob@example.com");
});

test("getSession returns null when no cookie exists", async () => {
  mockCookieStore.get.mockReturnValue(undefined);

  const session = await getSession();

  expect(session).toBeNull();
});

test("getSession returns null for an invalid token", async () => {
  mockCookieStore.get.mockReturnValue({ value: "invalid-token-garbage" });

  const session = await getSession();

  expect(session).toBeNull();
});

test("getSession returns null for a token signed with a different secret", async () => {
  const wrongSecret = new TextEncoder().encode("wrong-secret");
  const token = await new SignJWT({ userId: "user-1", email: "a@b.com" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setIssuedAt()
    .sign(wrongSecret);

  mockCookieStore.get.mockReturnValue({ value: token });

  const session = await getSession();

  expect(session).toBeNull();
});

test("getSession returns null for an expired token", async () => {
  const token = await new SignJWT({ userId: "user-1", email: "a@b.com" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("0s")
    .setIssuedAt(new Date(Date.now() - 10000))
    .sign(JWT_SECRET);

  // Small delay to ensure token is expired
  await new Promise((r) => setTimeout(r, 50));

  mockCookieStore.get.mockReturnValue({ value: token });

  const session = await getSession();

  expect(session).toBeNull();
});

test("deleteSession removes the auth-token cookie", async () => {
  await deleteSession();

  expect(mockCookieStore.delete).toHaveBeenCalledWith("auth-token");
});

test("verifySession returns payload from a valid request cookie", async () => {
  const token = await new SignJWT({
    userId: "user-mid",
    email: "mid@example.com",
    expiresAt: new Date().toISOString(),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .setIssuedAt()
    .sign(JWT_SECRET);

  const mockRequest = {
    cookies: {
      get: vi.fn().mockReturnValue({ value: token }),
    },
  } as any;

  const session = await verifySession(mockRequest);

  expect(session).not.toBeNull();
  expect(session!.userId).toBe("user-mid");
  expect(session!.email).toBe("mid@example.com");
  expect(mockRequest.cookies.get).toHaveBeenCalledWith("auth-token");
});

test("verifySession returns null when request has no cookie", async () => {
  const mockRequest = {
    cookies: {
      get: vi.fn().mockReturnValue(undefined),
    },
  } as any;

  const session = await verifySession(mockRequest);

  expect(session).toBeNull();
});

test("verifySession returns null for an invalid request cookie", async () => {
  const mockRequest = {
    cookies: {
      get: vi.fn().mockReturnValue({ value: "bad-token" }),
    },
  } as any;

  const session = await verifySession(mockRequest);

  expect(session).toBeNull();
});
