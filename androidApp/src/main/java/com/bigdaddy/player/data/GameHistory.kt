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
import androidx.room.Transaction
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "game_history")
data class GameHistoryEntity(
    @PrimaryKey val id: String,
    val gameCode: String,
    val roundId: String,
    val startedAtEpochMillis: Long,
    val endedAtEpochMillis: Long,
    val demoResult: String,
    val playerAccountId: String = "",
    val virtualBetAmount: String = "0",
    val virtualPayout: String = "0",
    val status: String = "COMPLETED"
)

@Dao
interface GameHistoryDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(item: GameHistoryEntity)

    @Query("SELECT * FROM game_history WHERE playerAccountId = :playerAccountId ORDER BY endedAtEpochMillis DESC")
    fun observeAll(playerAccountId: String): Flow<List<GameHistoryEntity>>

    @Query("SELECT * FROM game_history WHERE playerAccountId = :playerAccountId AND gameCode = :gameCode ORDER BY endedAtEpochMillis DESC")
    fun observeByGame(playerAccountId: String, gameCode: String): Flow<List<GameHistoryEntity>>

    @Query("DELETE FROM game_history WHERE id = :id AND playerAccountId = :playerAccountId")
    suspend fun delete(id: String, playerAccountId: String)

    @Query("DELETE FROM game_history WHERE playerAccountId = :playerAccountId AND id NOT IN (SELECT id FROM game_history WHERE playerAccountId = :playerAccountId ORDER BY endedAtEpochMillis DESC LIMIT :maxRows)")
    suspend fun pruneToLatest(playerAccountId: String, maxRows: Int)

    @Transaction
    suspend fun insertAndPrune(item: GameHistoryEntity) {
        insert(item)
        pruneToLatest(item.playerAccountId, 500)
    }
}

@Database(entities = [GameHistoryEntity::class], version = 2, exportSchema = true)
abstract class GameHistoryDatabase : RoomDatabase() {
    abstract fun historyDao(): GameHistoryDao

    companion object {
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("ALTER TABLE game_history ADD COLUMN playerAccountId TEXT NOT NULL DEFAULT ''")
            }
        }

        @Volatile private var instance: GameHistoryDatabase? = null

        fun get(context: Context): GameHistoryDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                GameHistoryDatabase::class.java,
                "bigdaddy-local-history.db"
            ).addMigrations(MIGRATION_1_2).build().also { instance = it }
        }
    }
}
