import UnoCSS from '@unocss/webpack';
import CopyPlugin from 'copy-webpack-plugin';
import * as dotenv from 'dotenv';
import type IForkTsCheckerWebpackPlugin from 'fork-ts-checker-webpack-plugin';
import MiniCssExtractPlugin from 'mini-css-extract-plugin';
import * as path from 'path';
import type { WebpackPluginInstance } from 'webpack';
import webpack from 'webpack';
import unoConfig from '../../uno.config';

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
  // 复制静态资源目录到 webpack 输出，用于打包后的应用
  // Copy static resource directories to webpack output for packaged app
  new CopyPlugin({
    patterns: [
      // skills 目录：包含 SKILL.md 文件，用于 SkillManager 加载
      { from: path.resolve(__dirname, '../../skills'), to: 'skills', noErrorOnMissing: true },
      // rules 目录：包含助手规则文件
      { from: path.resolve(__dirname, '../../rules'), to: 'rules', noErrorOnMissing: true },
      // assistant 目录：包含助手配置和技能定义
      { from: path.resolve(__dirname, '../../assistant'), to: 'assistant', noErrorOnMissing: true },
    ],
  }),
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
  {
    apply(compiler) {
      if (compiler.options.name?.startsWith('HtmlWebpackPlugin')) {
        return;
      }
      UnoCSS(unoConfig).apply(compiler);
    },
  },
  // tree-sitter의 ?binary wasm import 무시 (aioncli-core의 loadWasmBinary fallback이 디스크에서 읽도록)
  new webpack.IgnorePlugin({
    resourceRegExp: /\.wasm\?binary$/,
  }),
];
