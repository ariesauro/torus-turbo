export function getNaturalBiotSavartModulationWgsl() {
  return `
fn normalizeSafe(vector : vec3<f32>, fallback : vec3<f32>) -> vec3<f32> {
  let len = length(vector);
  if (len <= 1e-8) {
    return fallback;
  }
  return vector / len;
}

fn clamp01(value : f32) -> f32 {
  return min(max(value, 0.0), 1.0);
}

fn smoothstep01(value : f32) -> f32 {
  let t = clamp01(value);
  return t * t * (3.0 - 2.0 * t);
}

fn signedPow(value : f32, exponent : f32) -> f32 {
  let safeExponent = max(exponent, 0.25);
  let absValue = abs(value);
  let powered = pow(absValue, safeExponent);
  return select(-powered, powered, value >= 0.0);
}

fn controlNaturalCirculationDirection(sourcePosition : vec3<f32>, omega : vec3<f32>) -> vec3<f32> {
  if (!guidedDynamics()) {
    return omega;
  }

  let strengthExponent = 1.35;
  let strength = smoothstep01(pow(clamp01(guidedStrength()), strengthExponent));
  if (strength <= 0.0) {
    return omega;
  }

  let omegaMag = length(omega);
  if (omegaMag <= 1e-8) {
    return omega;
  }

  let radialXY = vec2<f32>(sourcePosition.x, sourcePosition.y);
  let radialLength = max(length(radialXY), 1e-6);
  let radialDir = vec3<f32>(radialXY.x / radialLength, radialXY.y / radialLength, 0.0);
  let torusCenter = radialDir * ringMajor();
  let normal = normalizeSafe(sourcePosition - torusCenter, radialDir);
  let eTheta = normalizeSafe(vec3<f32>(-radialDir.y, radialDir.x, 0.0), vec3<f32>(1.0, 0.0, 0.0));
  let ePhi = normalizeSafe(cross(normal, eTheta), vec3<f32>(0.0, 0.0, 1.0));

  let alphaExponent = 1.15;
  let thetaWeight = signedPow(cos(alpha()), alphaExponent) * spinSign();
  let phiWeight = signedPow(sin(alpha()), alphaExponent) * flipSign();
  let targetDir = normalizeSafe(thetaWeight * eTheta + phiWeight * ePhi, eTheta);

  let orientationSign = select(-1.0, 1.0, dot(omega, targetDir) >= 0.0);
  let desiredOmega = targetDir * (omegaMag * orientationSign);
  return omega + (desiredOmega - omega) * strength;
}
`
}
