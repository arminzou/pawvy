const fs = require('fs');
const path = require('path');

/**
 * Discover projects in the workspace and sync with the database.
 * Returns { discovered: number }
 */
function syncProjects(db, broadcast = null) {
  // Prefer PAWVY_PROJECTS_DIR, but keep PROJECTS_ROOT as legacy fallback
  const projectsRoots = (
    process.env.PAWVY_PROJECTS_DIR ||
    process.env.PROJECTS_ROOT ||
    path.join(require('os').homedir(), 'projects')
  ).split(path.delimiter);

  const discoveredProjects = new Map(); // Use a map to handle potential duplicates across roots
  const discoveredPaths = new Set();

  for (const projectsPath of projectsRoots) {
    if (!fs.existsSync(projectsPath)) {
      console.warn(`[syncProjects] Directory not found: ${projectsPath}`);
      continue;
    }

    const entries = fs.readdirSync(projectsPath, { withFileTypes: true });
    const dirs = entries.filter((e) => {
      const fullPath = path.join(projectsPath, e.name);
      const isDirectory = e.isDirectory() || (e.isSymbolicLink() && fs.statSync(fullPath).isDirectory());
      return (
        isDirectory &&
        !e.name.startsWith('.') &&
        // Smart discovery: ignore worktrees (folders with a .git file)
        !(
          fs.existsSync(path.join(fullPath, '.git')) &&
          fs.lstatSync(path.join(fullPath, '.git')).isFile()
        )
      );
    });

    for (const dir of dirs) {
      const slug = dir.name;
      if (discoveredProjects.has(slug)) continue; // Already found in a higher priority root

      const dirPath = path.resolve(path.join(projectsPath, slug)); // Use resolved absolute path
      if (discoveredPaths.has(dirPath)) continue;
      const name = slug
        .split(/[-_]/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      // Check for README to get description
      let description = '';
      const readmePath = path.join(dirPath, 'README.md');
      if (fs.existsSync(readmePath)) {
        try {
          const content = fs.readFileSync(readmePath, 'utf8');
          const firstLine = content.split('\n').find((l) => l.trim() && !l.startsWith('#'));
          if (firstLine) description = firstLine.trim().slice(0, 200);
        } catch {
          // ignore
        }
      }
      
      discoveredProjects.set(slug, { name, slug, path: dirPath, description });
      discoveredPaths.add(dirPath);
    }
  }

  // Read existing projects from DB
  const existing = db.prepare('SELECT slug, path FROM projects').all();
  const existingSlugs = new Set(existing.map((p) => p.slug));
  const existingPaths = new Set(existing.map((p) => path.resolve(p.path)));

  const insertStmt = db.prepare(`
    INSERT INTO projects (name, slug, path, description, icon, color)
    VALUES (?, ?, ?, ?, 'folder', '#6366f1')
  `);

  let newlyDiscovered = 0;
  for (const [slug, project] of discoveredProjects.entries()) {
    if (existingSlugs.has(slug)) continue;
    if (existingPaths.has(path.resolve(project.path))) continue;

    insertStmt.run(project.name, project.slug, project.path, project.description);
    existingPaths.add(path.resolve(project.path));
    newlyDiscovered++;
  }

  // Notify clients if new projects were discovered
  if (newlyDiscovered > 0 && broadcast) {
    console.log(`[syncProjects] Broadcasting projects_updated (discovered: ${newlyDiscovered})`);
    broadcast({ type: 'projects_updated', data: { discovered: newlyDiscovered } });
  }

  return { discovered: newlyDiscovered };
}

module.exports = { syncProjects };
