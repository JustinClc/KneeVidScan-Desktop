import { verifyAnalysisBundle } from './src/backend/analysisBundle';
import path from 'node:path';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    extendInfo: {
      NSCameraUsageDescription:
        'KneeVidScan uses connected cameras to capture standing photos and assessment recordings.',
    },
    name: 'KneeVidScan-Desktop',
    executableName: 'KneeVidScan-Desktop',
    icon: 'assets/branding/kneevidscan',
    // Offline MediaPipe WASM + pose model, served by the local backend.
    // ffmpeg turns WebM phone uploads into H.264 MP4.
    extraResource: [
      'assets/mediapipe',
      'assets/ffmpeg',
      'assets/branding',
      'assets/analysis-worker',
    ],
    afterCopy: [
      async ({ platform, arch }) => {
        verifyAnalysisBundle(path.resolve('.'), platform, arch);
      },
    ],
  },
  rebuildConfig: {},
  makers: [
    // Load makers by name so `pnpm start` does not import electron-winstaller.
    {
      name: '@electron-forge/maker-squirrel',
      config: {
        name: 'KneeVidScanDesktop',
        setupExe: 'KneeVidScan-Desktop-Setup.exe',
        setupIcon: 'assets/branding/kneevidscan.ico',
      },
    },
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin'],
      config: {},
    },
    {
      name: '@electron-forge/maker-rpm',
      config: { options: { icon: 'assets/branding/kneevidscan.png' } },
    },
    {
      name: '@electron-forge/maker-deb',
      config: { options: { icon: 'assets/branding/kneevidscan.png' } },
    },
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
