// Fixed renderer version boundary. Preloads and imports must use the same URL
// so the original application keeps one React runtime and shared module state.
import { webRendererPrefix } from './visualizations.ts';
const asset = (name: string) => webRendererPrefix + '/assets/' + name;
export const rendererAssets = {
  miniRoute: '/avatar-overlay?initialRoute=%2Favatar-overlay',
  mini: asset('avatar-overlay-native-page-d1ea5f6255c7.js'),
  client: asset('index.client-17f4cd7252fb.js'),
  shared: asset('app-shared-61271c39e3c5.js'),
  rpc: asset('rpc-e690e45d1264.js'),
  application: asset('app-initial-a68277f60b93.js'),
  applicationStyle: asset('app-initial-e7c27dd40beb.css'),
  primary: asset('app-primary-f5ea123a0407.js'),
  locale: asset('zh-CN-7ba80cbb133d.js'),
};
