const sizeNodeMajor = 22;

function checkSizeRuntime(nodeVersion) {
  if (Number(nodeVersion.split(".")[0]) !== sizeNodeMajor) {
    throw new Error(
      `Size measurements require Node.js ${sizeNodeMajor} to match CI; found ${nodeVersion}. Switch to Node.js ${sizeNodeMajor} and rerun npm run size.`,
    );
  }
}

if (require.main === module) checkSizeRuntime(process.versions.node);

module.exports = { checkSizeRuntime };
