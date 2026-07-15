import { AppError } from '@roundz/errors';

const languageCodePattern = /^[a-z]{2,3}(-[A-Z]{2})?$/;

export function assertValidCoordinates(latitude: number, longitude: number) {
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new AppError('Invalid coordinates', 400, 'USER_INVALID_COORDINATES');
  }
}

export function assertValidLanguageCode(language: string) {
  if (!languageCodePattern.test(language)) {
    throw new AppError('Invalid language code', 400, 'USER_INVALID_LANGUAGE');
  }
}

export function assertValidTimezone(timezone: string) {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
  } catch {
    throw new AppError('Invalid timezone', 400, 'USER_INVALID_TIMEZONE');
  }
}

export function assertValidImageUrl(imageUrl: string | null | undefined) {
  if (!imageUrl) {
    return;
  }

  const isProviderUri = /^[a-z][a-z0-9+.-]*:\/\/.+/i.test(imageUrl);

  if (!isProviderUri) {
    throw new AppError('Invalid profile image URL', 400, 'USER_INVALID_IMAGE_URL');
  }
}
