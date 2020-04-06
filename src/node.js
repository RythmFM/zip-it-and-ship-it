const { lstat } = require('fs')
const { dirname, normalize, sep } = require('path')

const commonPathPrefix = require('common-path-prefix')
const glob = require('glob')
const normalizePath = require('normalize-path')
const pkgDir = require('pkg-dir')
const promisify = require('util.promisify')

const { startZip, addZipFile, addZipContent, endZip } = require('./archive')
const { getDependencies } = require('./dependencies')

const pGlob = promisify(glob)
const pLstat = promisify(lstat)

// Zip a Node.js function file
const zipNodeJs = async function(srcPath, srcDir, destPath, filename, handler, stat) {
  const { archive, output } = startZip(destPath)

  const packageRoot = await pkgDir(srcDir)

  const files = await filesForFunctionZip(srcPath, filename, handler, packageRoot, stat)
  const dirnames = files.map(dirname)
  const commonPrefix = commonPathPrefix(dirnames)

  addEntryFile(commonPrefix, archive, filename, handler)

  await Promise.all(files.map(file => zipJsFile(file, commonPrefix, archive)))

  await endZip(archive, output)
}

// Retrieve the paths to the files to zip.
// We only include the files actually needed by the function because AWS Lambda
// has a size limit for the zipped file. It also makes cold starts faster.
const filesForFunctionZip = async function(srcPath, filename, handler, packageRoot, stat) {
  const [treeFiles, depFiles] = await Promise.all([getTreeFiles(srcPath, stat), getDependencies(handler, packageRoot)])
  const files = [...treeFiles, ...depFiles].map(normalize)
  const uniqueFiles = [...new Set(files)]
  return uniqueFiles
}

// When using a directory, we include all its descendants except `node_modules`
const getTreeFiles = function(srcPath, stat) {
  if (!stat.isDirectory()) {
    return [srcPath]
  }

  return pGlob(`${srcPath}/**`, {
    ignore: `${srcPath}/**/node_modules/**`,
    nodir: true,
    absolute: true
  })
}

const addEntryFile = function(commonPrefix, archive, filename, handler) {
  const mainPath = normalizeFilePath(handler, commonPrefix)
  const content = Buffer.from(`module.exports = require('./${mainPath}')`)
  const entryFilename = filename.endsWith('.js') ? filename : `${filename}.js`

  addZipContent(archive, content, entryFilename)
}

const zipJsFile = async function(file, commonPrefix, archive) {
  const filename = normalizeFilePath(file, commonPrefix)
  const stat = await pLstat(file)
  addZipFile(archive, file, filename, stat)
}

// `adm-zip` and `require()` expect Unix paths.
// We remove the common path prefix.
// With files on different Windows drives, we keep the drive letter but not the
// colon `:` since this is forbidden in filenames.
const normalizeFilePath = function(path, commonPrefix) {
  const pathA = normalize(path)
  const pathB = pathA.replace(commonPrefix, `${ZIP_ROOT_DIR}${sep}`)
  const pathC = normalizePath(pathB)
  const pathD = pathC.replace(WINDOWS_DRIVE_REGEXP, '$1')
  return pathD
}

const ZIP_ROOT_DIR = 'src'
const WINDOWS_DRIVE_REGEXP = /^([a-zA-Z]+):/

module.exports = { zipNodeJs }
