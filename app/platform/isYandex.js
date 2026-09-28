// True for `dev:yandex` / `build:yandex` only. Next inlines this at build time, so website code can branch without shipping the SDK.
export const IS_YANDEX = process.env.NEXT_PUBLIC_PLATFORM === 'yandex';
