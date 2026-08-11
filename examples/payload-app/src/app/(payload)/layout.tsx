import { handleServerFunctions, RootLayout } from '@payloadcms/next/layouts'
import config from '@payload-config'
import type { ServerFunctionClient } from 'payload'
import '@payloadcms/next/css'
import { importMap } from './admin/importMap.js'

const serverFunction: ServerFunctionClient = (args) => handleServerFunctions({ ...args, config, importMap })

export default function Layout({ children }: { children: React.ReactNode }) {
  return <RootLayout config={config} importMap={importMap} serverFunction={serverFunction}>{children}</RootLayout>
}
