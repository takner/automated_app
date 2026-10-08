export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}

export const notFound = () => new HttpError(404, 'پیدا نشد', 'not_found');
