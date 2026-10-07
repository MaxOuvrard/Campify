import { CommandParams } from '../entities/Command'
import { ValidationError } from '../../shared/errors'

/**
 * Liste blanche des commandes qu'un objet peut recevoir (ADR 0014). Une
 * commande hors liste, ou avec des paramètres invalides, est refusée AVANT
 * d'être persistée ou publiée : rien d'arbitraire ne part jamais vers un
 * objet physique. Ajouter un type de commande = ajouter une entrée ici.
 */
type ParamsValidator = (params: Record<string, unknown>) => CommandParams

export const TARGET_TEMPERATURE_RANGE = { min: 10, max: 30 }

const catalog: Record<string, ParamsValidator> = {
  set_ventilation: (params) => {
    if (typeof params.on !== 'boolean') {
      throw new ValidationError('set_ventilation requires params.on (boolean)')
    }
    return { on: params.on }
  },
  set_target_temperature: (params) => {
    const value = params.value
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ValidationError('set_target_temperature requires params.value (number)')
    }
    if (value < TARGET_TEMPERATURE_RANGE.min || value > TARGET_TEMPERATURE_RANGE.max) {
      throw new ValidationError(
        `set_target_temperature params.value must be between ${TARGET_TEMPERATURE_RANGE.min} and ${TARGET_TEMPERATURE_RANGE.max}`
      )
    }
    return { value }
  }
}

export const SUPPORTED_COMMAND_TYPES = Object.keys(catalog)

/** Valide le type et les paramètres d'une commande ; renvoie les paramètres normalisés (champs inconnus retirés). */
export function validateCommand(type: string, params: unknown): CommandParams {
  const validator = catalog[type]
  if (validator === undefined) {
    throw new ValidationError(`Unsupported command type "${type}" (supported: ${SUPPORTED_COMMAND_TYPES.join(', ')})`)
  }
  if (params === null || typeof params !== 'object' || Array.isArray(params)) {
    throw new ValidationError(`${type} requires a params object`)
  }
  return validator(params as Record<string, unknown>)
}
