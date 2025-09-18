import path from 'node:path'

export default {
  resolve: {
    alias: {
      '@opal': path.resolve(__dirname, 'src/devices/OpalIceMaker'),
      '@root': path.resolve(__dirname, 'src'),
    },
  },
}
