/**
 * ShaderProgram.js
 * Generic WebGL2 shader compile/link wrapper with cached attribute/uniform
 * location lookups.
 */
export class ShaderProgram {
  #gl;
  #program;
  #uniformCache;
  #attribCache;

  /**
   * @param {WebGL2RenderingContext} gl
   * @param {WebGLProgram} program
   */
  constructor(gl, program) {
    this.#gl = gl;
    this.#program = program;
    this.#uniformCache = new Map();
    this.#attribCache = new Map();
  }

  /**
   * Compiles and links a vertex+fragment shader pair into a usable program.
   * @param {WebGL2RenderingContext} gl
   * @param {string} vertSource
   * @param {string} fragSource
   * @returns {ShaderProgram}
   * @throws {Error} on compile or link failure, including the GL info log.
   */
  static fromSources(gl, vertSource, fragSource) {
    const vertShader = ShaderProgram.#compile(gl, gl.VERTEX_SHADER, vertSource);
    const fragShader = ShaderProgram.#compile(gl, gl.FRAGMENT_SHADER, fragSource);

    const program = gl.createProgram();
    gl.attachShader(program, vertShader);
    gl.attachShader(program, fragShader);
    gl.linkProgram(program);

    gl.detachShader(program, vertShader);
    gl.detachShader(program, fragShader);
    gl.deleteShader(vertShader);
    gl.deleteShader(fragShader);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`ShaderProgram: link failed: ${log}`);
    }

    return new ShaderProgram(gl, program);
  }

  static #compile(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
      gl.deleteShader(shader);
      throw new Error(`ShaderProgram: ${kind} shader compile failed: ${log}`);
    }
    return shader;
  }

  use() {
    this.#gl.useProgram(this.#program);
  }

  /** @param {string} name @returns {WebGLUniformLocation | null} */
  uniformLocation(name) {
    if (!this.#uniformCache.has(name)) {
      this.#uniformCache.set(name, this.#gl.getUniformLocation(this.#program, name));
    }
    return this.#uniformCache.get(name);
  }

  /** @param {string} name @returns {number} */
  attribLocation(name) {
    if (!this.#attribCache.has(name)) {
      this.#attribCache.set(name, this.#gl.getAttribLocation(this.#program, name));
    }
    return this.#attribCache.get(name);
  }

  get rawProgram() {
    return this.#program;
  }

  dispose() {
    this.#gl.deleteProgram(this.#program);
  }
}
