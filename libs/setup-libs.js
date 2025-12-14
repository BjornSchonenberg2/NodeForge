// setup-libs.js
// Run from: mr3d/libs  with  node setup-libs.js
// Copies Three.js files from ../node_modules/three into ./libs

const fs = require("fs");
const path = require("path");

const here = __dirname; // ...\mr3d\libs
const projectRoot = path.join(here, ".."); // ...\mr3d
const threeRoot = path.join(projectRoot, "node_modules", "three");
const libsDir = path.join(here, "libs");

function ensureThreeExists() {
    if (!fs.existsSync(threeRoot)) {
        console.error(
            "❌ Could not find 'three' in node_modules.\n" +
            "Make sure you ran 'npm install three' in the project root (mr3d)."
        );
        process.exit(1);
    } else {
        console.log("✔ Found three in:", threeRoot);
    }
}

function ensureLibsDir() {
    if (!fs.existsSync(libsDir)) {
        fs.mkdirSync(libsDir, { recursive: true });
        console.log("Created libs folder:", libsDir);
    } else {
        console.log("Using existing libs folder:", libsDir);
    }
}

// pick a usable build file for global THREE (non-module)
function resolveThreeBuild() {
    const candidates = [
        path.join(threeRoot, "build", "three.min.js"),
        path.join(threeRoot, "build", "three.js"),
        path.join(threeRoot, "dist", "three.min.js"),
        path.join(threeRoot, "dist", "three.js"),
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            console.log("✔ Using Three build:", p);
            return p;
        }
    }

    throw new Error(
        "Could not find a Three.js build file (tried build/dist three.min.js / three.js)"
    );
}

function copyFile(src, destName) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(src)) {
            return reject(new Error("Source file not found: " + src));
        }
        const destPath = path.join(libsDir, destName);
        fs.copyFile(src, destPath, (err) => {
            if (err) return reject(err);
            console.log("✔ Copied", destName);
            resolve();
        });
    });
}

async function main() {
    try {
        ensureThreeExists();
        ensureLibsDir();

        const threeBuildSrc = resolveThreeBuild();

        const files = [
            // We always copy whatever build we found to "three.min.js"
            { src: threeBuildSrc, dest: "three.min.js" },
            {
                src: path.join(threeRoot, "examples", "js", "controls", "OrbitControls.js"),
                dest: "OrbitControls.js",
            },
            {
                src: path.join(threeRoot, "examples", "js", "loaders", "GLTFLoader.js"),
                dest: "GLTFLoader.js",
            },
            {
                src: path.join(threeRoot, "examples", "js", "exporters", "GLTFExporter.js"),
                dest: "GLTFExporter.js",
            },
        ];

        for (const f of files) {
            await copyFile(f.src, f.dest);
        }

        console.log("\n✅ All files copied into:", libsDir, "\n");
    } catch (err) {
        console.error("\n✖ Error:", err.message);
    }
}

main();
