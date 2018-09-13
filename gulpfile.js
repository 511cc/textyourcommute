const gulp = require('gulp');
const source = require('vinyl-source-stream');
const watchify = require('watchify');
const browserify = require('browserify');
const plugins = require('gulp-load-plugins')();

const bundler = watchify(browserify('./public/js/index.js', watchify.args));
bundler.on('update', bundle);
bundler.on('log', plugins.util.log);

function bundle() {
  return bundler.bundle()
    // Log errors
    .on('error', plugins.util.log.bind(plugins.util, 'Browserify Error'))
    .pipe(source('index.js'))
    // Build sourcemaps
    .pipe(require('vinyl-buffer')())
    .pipe(plugins.sourcemaps.init({loadMaps: true})) // Loads map from browserify file
    .pipe(plugins.sourcemaps.write('./')) // Writes .map file
    .pipe(gulp.dest('./public/dest'));
}

gulp.task('scss:lint', () => {
  gulp.src('./public/scss/**/*.scss')
    .pipe(plugins.scssLint());
});

gulp.task('scss:compileDev', () => {
  gulp.src('./public/scss/**/*.scss')
    // Build sourcemaps
    .pipe(plugins.sourcemaps.init())
    .pipe(plugins.sass({errLogToConsole: true}))
    .pipe(plugins.sourcemaps.write())
    .pipe(gulp.dest('./public/css'));
});

gulp.task('scss:compile', ['fonts:copy'], () => {
  gulp.src('./public/scss/**/*.scss')
    .pipe(plugins.sass({errLogToConsole: true}))
    .pipe(gulp.dest('./public/css'));
});

gulp.task('css:minify', ['scss:compile'], () => {
  gulp.src('./public/css/*.css')
    .pipe(plugins.cleanCss())
    .pipe(gulp.dest('./public/css'));
});

gulp.task('js:develop', () => {
  bundle();
});

gulp.task('js:compress', () => {
  const bundleStream = browserify('./public/js/index.js')
    .bundle();

  bundleStream
    .pipe(source('index.js'))
    .pipe(plugins.streamify(plugins.uglify()))
    .pipe(require('vinyl-buffer')())
    .pipe(plugins.sourcemaps.init({loadMaps: true}))
    .pipe(plugins.sourcemaps.write('./'))
    .pipe(gulp.dest('./public/dest'));
});

gulp.task('scss:develop', ['scss:lint', 'scss:compileDev']);

gulp.task('fonts:copy', () => {
  gulp.src(['./node_modules/bootstrap-sass/assets/fonts/bootstrap/*'])
    .pipe(gulp.dest('./public/dest/fonts'));
});

gulp.task('css:copy', () => {
  gulp.src('./node_modules/css-toggle-switch/dist/**/*')
    .pipe(gulp.dest('./public/css/css-toggle-switch'));
});

gulp.task('develop', () => {
  const server = plugins.liveServer.new('bin/www');
  server.start();

  // Watch for sass changes
  gulp.watch(['public/scss/**/*.scss'], ['scss:develop']);

  // Watch for jsx changes
  gulp.watch([
    'public/jsx/**/*.jsx',
    'public/js/**/*.js'
  ], ['js:develop']);

  // Watch for front-end changes
  gulp.watch([
    'public/dest/**/*.js',
    'public/css/**/*.css',
    'public/images/**/*',
    'views/**/*.pug'
  ], function () {
    server.notify.apply(server, arguments);
  });

  // Watch for back-end js changes
  gulp.watch([
    'app.js',
    'routes/**/*.js',
    'lib/**/*.js'
  ], () => {
    server.start.bind(server);
  });
});

gulp.task('build', [
  'fonts:copy',
  'css:copy',
  'css:minify',
  'js:compress'
]);
