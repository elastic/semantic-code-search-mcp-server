import { Response, NextFunction } from 'express';
import { authMiddleware, AuthenticatedRequest } from '../../src/middleware/auth';
import * as oidc from '../../src/lib/oidc';

// Mock the config module
jest.mock('../../src/config', () => ({
  oidcConfig: {
    enabled: false,
    issuer: 'https://example.okta.com/oauth2/default',
    audience: 'api://test',
    requiredClaims: ['sub'],
  },
}));

// Mock the OIDC utilities
jest.mock('../../src/lib/oidc', () => ({
  validateAccessToken: jest.fn(),
  validateIdToken: jest.fn(),
  introspectAccessToken: jest.fn(),
}));

describe('Auth Middleware', () => {
  let mockRequest: Partial<AuthenticatedRequest>;
  let mockResponse: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    mockRequest = {
      headers: {},
      path: '/mcp',
      method: 'POST',
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    mockNext = jest.fn();

    // Reset console.log and console.error mocks
    jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();

    (oidc.validateIdToken as jest.Mock).mockRejectedValue(new Error('Not an ID token'));
    (oidc.introspectAccessToken as jest.Mock).mockRejectedValue(new Error('Not an opaque token'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('when auth is disabled', () => {
    it('should call next without validation', async () => {
      await authMiddleware(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);
      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });
  });

  describe('when auth is enabled', () => {
    beforeEach(() => {
      // Enable auth for these tests
      const { oidcConfig } = jest.requireMock('../../src/config') as { oidcConfig: { enabled: boolean } };
      oidcConfig.enabled = true;
    });

    it('should return 401 when Authorization header is missing', async () => {
      await authMiddleware(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Authentication required',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when Authorization header format is invalid', async () => {
      mockRequest.headers = { authorization: 'InvalidFormat token123' };
      await authMiddleware(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should return 401 when token validation fails', async () => {
      (oidc.validateAccessToken as jest.Mock).mockRejectedValueOnce(new Error('Token expired'));

      mockRequest.headers = { authorization: 'Bearer invalid_token' };
      await authMiddleware(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it('should attach user to request and call next when token is valid', async () => {
      const mockClaims = { sub: '12345', email: 'user@example.com' };
      (oidc.validateAccessToken as jest.Mock).mockResolvedValueOnce(mockClaims);

      mockRequest.headers = { authorization: 'Bearer valid_token' };
      await authMiddleware(mockRequest as AuthenticatedRequest, mockResponse as Response, mockNext);

      expect(mockRequest.user).toEqual(mockClaims);
      expect(mockNext).toHaveBeenCalled();
      expect(mockResponse.status).not.toHaveBeenCalled();
    });
  });
});
