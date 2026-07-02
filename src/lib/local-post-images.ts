import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ImageSourceType, PostImage } from '@/types'

const STORE_DIR = path.join(process.cwd(), '.voicefit-local')
const STORE_FILE = path.join(STORE_DIR, 'post-images.json')
export const LOCAL_IMAGE_DIR = path.join(STORE_DIR, 'images')

type LocalPostImagePatch = Partial<Pick<PostImage, 'vision_interpretation' | 'placement_index' | 'generated_paragraph'>>

async function readImages(): Promise<PostImage[]> {
  try {
    const raw = await readFile(STORE_FILE, 'utf8')
    return JSON.parse(raw) as PostImage[]
  } catch {
    return []
  }
}

async function writeImages(images: PostImage[]) {
  await mkdir(STORE_DIR, { recursive: true })
  await writeFile(STORE_FILE, JSON.stringify(images, null, 2), 'utf8')
}

function sortForRendering(images: PostImage[]): PostImage[] {
  return [...images].sort((a, b) => {
    const ai = a.placement_index ?? 999
    const bi = b.placement_index ?? 999
    if (ai !== bi) return ai - bi
    return a.created_at.localeCompare(b.created_at)
  })
}

function extensionFromMime(mime: string): string {
  if (mime === 'image/png') return 'png'
  if (mime === 'image/gif') return 'gif'
  if (mime === 'image/webp') return 'webp'
  return 'jpg'
}

function safeExtension(file: File): string {
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext && /^[a-z0-9]{1,8}$/.test(ext)) return ext
  return extensionFromMime(file.type)
}

export function getLocalImagePublicUrl(postId: string, fileName: string): string {
  return `/api/local-images/${encodeURIComponent(postId)}/${encodeURIComponent(fileName)}`
}

export function resolveLocalImagePath(postId: string, fileName: string): string {
  const base = path.resolve(LOCAL_IMAGE_DIR, postId)
  const target = path.resolve(base, fileName)
  if (!target.startsWith(base + path.sep)) {
    throw new Error('Invalid local image path')
  }
  return target
}

export async function listLocalPostImages(postId: string): Promise<PostImage[]> {
  const images = await readImages()
  return sortForRendering(images.filter((img) => img.post_id === postId))
}

export async function getLocalPostImage(postId: string, imageId: string): Promise<PostImage | null> {
  const images = await readImages()
  return images.find((img) => img.post_id === postId && img.id === imageId) ?? null
}

export async function saveLocalUploadedImage(postId: string, file: File): Promise<PostImage> {
  const ext = safeExtension(file)
  const fileName = `${Date.now()}-${randomUUID()}.${ext}`
  const dir = path.join(LOCAL_IMAGE_DIR, postId)
  await mkdir(dir, { recursive: true })

  const bytes = await file.arrayBuffer()
  await writeFile(path.join(dir, fileName), Buffer.from(bytes))

  const now = new Date().toISOString()
  const image: PostImage = {
    id: `local_img_${randomUUID()}`,
    post_id: postId,
    source_type: 'user_uploaded',
    storage_path: `images/${postId}/${fileName}`,
    public_url: getLocalImagePublicUrl(postId, fileName),
    vision_interpretation: null,
    placement_index: null,
    generated_paragraph: null,
    created_at: now,
  }

  const images = await readImages()
  images.unshift(image)
  await writeImages(images)
  return image
}

export async function insertLocalOfficialImages(postId: string, urls: string[]): Promise<PostImage[]> {
  if (!urls.length) return []

  const now = new Date().toISOString()
  const rows = urls.map((url) => ({
    id: `local_img_${randomUUID()}`,
    post_id: postId,
    source_type: 'official' as ImageSourceType,
    storage_path: '',
    public_url: url,
    vision_interpretation: '상품 공식 이미지',
    placement_index: 1,
    generated_paragraph: null,
    created_at: now,
  }))

  const images = await readImages()
  images.unshift(...rows)
  await writeImages(images)
  return rows
}

export async function updateLocalPostImage(imageId: string, patch: LocalPostImagePatch): Promise<PostImage | null> {
  const images = await readImages()
  const index = images.findIndex((img) => img.id === imageId)
  if (index < 0) return null
  images[index] = { ...images[index], ...patch }
  await writeImages(images)
  return images[index]
}

export async function readLocalUploadedImage(postId: string, image: PostImage): Promise<Buffer> {
  if (image.source_type !== 'user_uploaded') {
    throw new Error('로컬 업로드 이미지가 아닙니다.')
  }

  const fileName = path.basename(image.storage_path)
  const target = resolveLocalImagePath(postId, fileName)
  return readFile(target)
}
