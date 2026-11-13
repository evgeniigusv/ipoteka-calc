// Фрагмент с правом просмотра не передаётся серверу GitHub Pages.
const key = location.hash.slice(1);
if (/^[A-Za-z0-9_-]{43}$/.test(key)) {
  location.replace('https://192.144.15.206/marketing/s/' + key + '/');
}
