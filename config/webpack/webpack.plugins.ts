import UnoCSS from '@unocss/webpack';
import * as dotenv from 'dotenv';
import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import * as path from 'path';
import type { WebpackPluginInstance } from 'webpack';
import webpack from 'webpack';

// .env 파일 로드
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ForkTsCheckerWebpackPlugin: typeof IForkTsCheckerWebpackPlugin = require('fork-ts-checker-webpack-plugin');

// VITE_ 접두사가 붙은 환경 변수만 클라이언트에 노출
const envKeys = Object.keys(process.env)
  .filter((key) => key.startsWith('VITE_'))
  .reduce(
    (prev, next) => {
      prev[`process.env.${next}`] = JSON.stringify(process.env[next]);
      return prev;
    },
    {} as Record<string, string>
  );

export const plugins: WebpackPluginInstance[] = [
  new ForkTsCheckerWebpackPlugin({
    logger: 'webpack-infrastructure',
  }),
  new webpack.DefinePlugin({
    'process.env.env': JSON.stringify(process.env.env),
    ...envKeys, // Firebase 등 VITE_ 환경 변수 주입
  }),
  new MiniCssExtractPlugin({
    filename: '[name].css',
    chunkFilename: '[id].css',
  }),
  UnoCSS(),
  // tree-sitter의 ?binary wasm import 무시
  new webpack.IgnorePlugin({
    resourceRegExp: /\.wasm\?binary$/,
  }),
];
