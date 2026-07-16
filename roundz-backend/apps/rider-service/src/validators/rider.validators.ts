import { AppError } from '@roundz/errors';

const languageCodePattern = /^[a-z]{2,3}(-[A-Z]{2})?$/;

export function assertValidLanguageCode(language: string) {
  if (!languageCodePattern.test(language)) {
    throw new AppError('Invalid language code', 400, 'RIDER_INVALID_LANGUAGE');
  }
}

export function assertValidStorageUri(uri: string | null | undefined) {
  if (!uri) {
    return;
  }

  const isProviderUri = /^[a-z][a-z0-9+.-]*:\/\/.+/i.test(uri);

  if (!isProviderUri) {
    throw new AppError('Invalid storage URI', 400, 'RIDER_INVALID_STORAGE_URI');
  }
}

export function assertFutureExpiry(label: string, date: Date | null | undefined, code: string) {
  if (!date) {
    return;
  }

  if (date.getTime() <= Date.now()) {
    throw new AppError(`${label} must be a future date`, 400, code);
  }
}
