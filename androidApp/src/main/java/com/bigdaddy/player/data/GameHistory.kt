package com.bigdaddy.player.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "game_history")
data class GameHistoryEntity(
    @PrimaryKey val id: String,
    val gameCode: String,
    val roundId: String,
    val startedAtEpochMillis: Long,
    val endedAtEpochMillis: Long,
    val demoResult: String,
    val virtualBetAmount: String = "0",
    val virtualPayout: String = "0",
    val status: String = "COMPLETED"
)

@Dao
interface GameHistoryDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(item: GameHistoryEntity)

    @Query("SELECT * FROM game_history ORDER BY endedAtEpochMillis DESC")
    fun observeAll(): Flow<List<GameHistoryEntity>>

    @Query("SELECT * FROM game_history WHERE gameCode = :gameCode ORDER BY endedAtEpochMillis DESC")
    fun observeByGame(gameCode: String): Flow<List<GameHistoryEntity>>

    @Query("DELETE FROM game_history WHERE id = :id")
    suspend fun delete(id: String)
}

@Database(entities = [GameHistoryEntity::class], version = 1, exportSchema = true)
abstract class GameHistoryDatabase : RoomDatabase() {
    abstract fun historyDao(): GameHistoryDao

    companion object {
        @Volatile private var instance: GameHistoryDatabase? = null

        fun get(context: Context): GameHistoryDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                GameHistoryDatabase::class.java,
                "bigdaddy-local-history.db"
            ).build().also { instance = it }
        }
    }
}
