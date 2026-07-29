import { BoundaryError } from '#errors'

// A non-2xx response or a network/transport failure.
export class ApiRequestError extends BoundaryError {}

// The response body didn't match the expected wire schema.
export class ApiResponseShapeError extends BoundaryError {}
