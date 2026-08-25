/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // Stub optional deps from @coinbase/cdp-sdk that aren't published.
    // We don't use the Base Account flow, so these code paths never execute.
    config.resolve.alias = {
      ...config.resolve.alias,
      '@x402/evm': false,
      '@x402/svm/exact/client': false,
      '@x402/evm/upto/client': false,
      '@x402/evm/exact/client': false,
      '@x402/core/client': false,
    };
    return config;
  },
};

module.exports = nextConfig;
