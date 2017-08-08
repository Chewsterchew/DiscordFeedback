const Dash = require('rethinkdbdash')
const r = new Dash()
const roles = require('../roles')
const genlog = require('./generic_logger')

module.exports = {
  awardPoints: (user, type) => {
    return new Promise((resolve, reject) => {
      let now = new Date()
      let today = new Date(now.getFullYear(), now.getUTCMonth(), now.getUTCDate()).getTime()
      let consecutive
      let streak
      r.db('DFB').table('analytics').get(user).then(o => {
        if (o === null) return r.db('DFB').table('analytics').insert({
          id: user,
          consecutive: [],
          streak: 0
        })
        consecutive = o.consecutive !== undefined ? o.consecutive : [today.toString()]
        streak = o.streak !== undefined ? o.streak : 0
        if (consecutive.indexOf(today.toString()) === -1) {
          let last = new Date(parseInt(consecutive[consecutive.length -1]))
          let difference = today - last
          if (difference === 86400000) { // 1 day difference
            consecutive.push(today.toString())
            if (consecutive.length > 1 && streak === 0) streak = consecutive.length // backwards compatibility
            if (consecutive.length - streak === 1) { // streak counter is 1 day behind
              streak++
            }
          } else {
            consecutive = [today.toString()]
          }
        }
        r.db('DFB').table('analytics').get(user).update({
          [type]: { [today]: r.row(type)(today.toString()).default(0).add(1) },
          consecutive: consecutive,
          streak: streak
        }).run().then(resolve).catch(reject)
      })
    })
  },
  getPoints: (user) => {
    return new Promise((resolve, reject) => {
      r.db('DFB').table('analytics').get(user).run().then(resolve).catch(reject)
    })
  },
  roleUsers: (guild, bot) => {
    r.db("DFB").table("analytics").run().then((results) => {
      results.forEach((row) => {
        let totalDays = Object.keys(row.messages).length
        let consecutiveDays = row.streak
        let member = guild.members.find(member => member.id === row.id)
        if (!member) return;
        
        // is the user active?
        let active = false

        var roleWeights = [] // array of role weights for every role the user has

        Object.entries(roles).forEach(([key, role]) => {
          if (member.hasRole(key)) {
            // if user has role, then get all dates in between role.decay and now
            // if user has not interacted in those dates, then they are no longer active
            let dates = Array.apply(null, new Array(role.decay)).map((v, i) => {
              var d = new Date();
              d.setDate(d.getDate() + i + 1 - 7)
              d.setHours(0,0,0,0)
              return d.getTime()
            })
            if (dates.some(date => date in row.messages)) active = true;
          }

          if (!active) {
            if (member.hasRole(key)) roleWeights.push(role.rank)
          } else if (totalDays && consecutiveDays >= role.threshold) {
            if (member.hasRole(key)) return
            if (role.message) {
              member.openDM().then((channel) => {
                channel.sendMessage(`Hey ${member.name}! ${role.message}`)
              })
            }
            member.assignRole(key).then(() => { 
              genlog.log(bot, bot.User, { 
                message: `Added ${member.name}#${member.discriminator} to ${role.name}.`
              })
            })
            return
          }
        })

        if (!active) {
          if (roleWeights.length === 0) return; // has no roles :c
          let highest = Math.max.apply(Math, roleWeights)
          // We can loop again now we know what we're looking for
          Object.entries(roles).some(([key, role]) => {
            if (role.rank === highest)  {
              member.unassignRole(key).then(() => {
                genlog.log(bot, bot.User, { 
                  message: `Removed ${role.name} from ${member.name}#${member.discriminator}.`
                })
                member.openDM().then((channel) => {
                  channel.sendMessage(`Hey ${member.name}! Looks like you haven't been active in the Discord Feedback server for a while. As a result, you've lost your current role of ${role.name}. Don't worry though, you can absolutely earn your old role back! Just starting chatting and using the bot once per day!`)
                })
              })
              return true
            }
          })
        }

      })
    })
  }
}