import { sqliteAdapter } from '@payloadcms/db-sqlite'
import { mcpPlugin } from '@payloadcms/plugin-mcp'
import { lexicalEditor } from '@payloadcms/richtext-lexical'
import { createPlugloadCollections, createPlugloadMcpResources, createPlugloadMcpTools } from '@plugload/mcp'
import { buildConfig, type CollectionConfig, type GlobalConfig } from 'payload'

const isAuthenticated = ({ req }: any) => Boolean(req.user)

const Users: CollectionConfig = {
  slug: 'users',
  auth: true,
  admin: { useAsTitle: 'email' },
  access: { read: isAuthenticated, create: isAuthenticated, update: isAuthenticated, delete: isAuthenticated },
  fields: [{ name: 'role', type: 'select', required: true, defaultValue: 'editor', options: ['editor', 'publisher', 'admin'] }],
}

const Categories: CollectionConfig = {
  slug: 'categories',
  admin: { useAsTitle: 'name' },
  access: { read: () => true, create: isAuthenticated, update: isAuthenticated, delete: isAuthenticated },
  fields: [{ name: 'name', type: 'text', required: true, unique: true }, { name: 'description', type: 'textarea', localized: true }],
}

const Posts: CollectionConfig = {
  slug: 'posts',
  admin: { useAsTitle: 'title' },
  versions: { drafts: { autosave: true }, maxPerDoc: 25 },
  access: {
    read: ({ req }) => req.user ? true : { _status: { equals: 'published' } },
    create: isAuthenticated,
    update: isAuthenticated,
    delete: ({ req }: any) => req.user?.role === 'admin',
    readVersions: isAuthenticated,
  },
  fields: [
    { name: 'title', type: 'text', required: true, localized: true, maxLength: 120 },
    { name: 'slug', type: 'text', required: true, unique: true, index: true },
    { name: 'summary', type: 'textarea', localized: true, maxLength: 320 },
    { name: 'body', type: 'richText', localized: true, required: true },
    { name: 'categories', type: 'relationship', relationTo: 'categories', hasMany: true },
    { name: 'author', type: 'relationship', relationTo: 'users', required: true },
    { name: 'reviewStatus', type: 'select', defaultValue: 'draft', options: ['draft', 'review', 'approved'] },
  ],
}

const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  access: { read: () => true, update: isAuthenticated },
  versions: { drafts: true, max: 10 },
  fields: [{ name: 'siteName', type: 'text', required: true }, { name: 'announcement', type: 'text', localized: true }],
}

const environment = (process.env.PLUGLOAD_ENVIRONMENT ?? 'development') as 'development' | 'preview' | 'staging' | 'production'
const plugloadTools = createPlugloadMcpTools({ environment, projectName: 'example' })
const plugloadResources = createPlugloadMcpResources({ environment, projectName: 'example' })

export default buildConfig({
  secret: process.env.PAYLOAD_SECRET ?? 'local-development-secret-change-me',
  db: sqliteAdapter({ client: { url: process.env.DATABASE_URI ?? 'file:./plugload-example.db' } }),
  editor: lexicalEditor(),
  localization: { locales: ['en', 'es'], defaultLocale: 'en', fallback: true },
  collections: [Users, Categories, Posts, ...createPlugloadCollections()],
  globals: [SiteSettings],
  plugins: [
    mcpPlugin({
      overrideAuth: async (req, getDefaultMcpAccessSettings) => {
        const settings = await getDefaultMcpAccessSettings()
        req.user = settings.user as typeof req.user
        return settings
      },
      collections: {
        posts: { enabled: { find: true, create: true, update: true, delete: false }, description: 'Localized editorial posts with drafts and review state.' },
        categories: { enabled: { find: true, create: true, update: true, delete: false }, description: 'Post taxonomy categories.' },
      },
      globals: { 'site-settings': { enabled: { find: true, update: true }, description: 'Site-wide name and announcement.' } },
      mcp: {
        tools: plugloadTools,
        resources: plugloadResources,
        handlerOptions: { verboseLogs: environment === 'development', onEvent: (event) => console.info('[Payload MCP event]', event) },
        serverOptions: { serverInfo: { name: 'Plugload example Payload MCP', version: '0.1.0' } },
      },
    }),
  ],
})
