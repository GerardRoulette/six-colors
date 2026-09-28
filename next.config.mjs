/** @type {import('next').NextConfig} */
// Yandex upload is a static archive. The website build keeps the default Next server.
const isYandexExport = process.env.NEXT_PUBLIC_PLATFORM === 'yandex';

const nextConfig = isYandexExport
  ? {
      output: 'export',
      images: { unoptimized: true },
      trailingSlash: true,
    }
  : {};

export default nextConfig;
