// `node:os` for the Android WebView bundle. yt-dlp-bridge reads it once at
// import time to build its default server config, which the caller-supplied
// workflows Arroxy plans never consult.
const os = {homedir: (): string => '/', tmpdir: (): string => '/tmp', platform: (): string => 'android'}

export default os
export const {homedir, tmpdir, platform} = os
