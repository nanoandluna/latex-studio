import fs from 'node:fs';

let s = fs.readFileSync('package.json', 'utf8');
// repair literal "`n" sequences left by PowerShell backtick escaping
s = s.replace(/`,n(\s*)"/g, '",$1"');
// also collapse any stray ",n    " inside values
s = s.replace(/\",n\s+\"/g, '",\n    "');
fs.writeFileSync('package.json', s);

const j = JSON.parse(s);
console.log('parsed OK; stress =', j.scripts['test:stress']);
