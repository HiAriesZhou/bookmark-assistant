export const productConfig = {
  name: import.meta.env.VITE_APP_NAME || 'Bookmark Assistant',
  faqUrl: import.meta.env.VITE_FAQ_URL || '',
  privacyUrl: import.meta.env.VITE_PRIVACY_URL || '',
  termsUrl: import.meta.env.VITE_TERMS_URL || '',
  // GPL source for this build; forks point it at their own repository.
  sourceUrl: import.meta.env.VITE_SOURCE_URL || 'https://github.com/HiAriesZhou/bookmark-assistant',
};
